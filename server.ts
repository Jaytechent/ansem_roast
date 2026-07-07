import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini SDK lazily to prevent crash if key is missing
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== "MY_GEMINI_API_KEY") {
      aiClient = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
  }
  return aiClient;
}

// Seeded random number generator for consistent results per wallet
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

class SeededRandom {
  private seed: number;
  constructor(seed: number) {
    this.seed = seed;
  }
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  choice<T>(arr: T[]): T {
    const idx = Math.floor(this.next() * arr.length);
    return arr[idx];
  }
}

// Famous wallets easter eggs
const EASTER_EGGS: Record<string, any> = {
  "ansem": {
    walletIQ: 155,
    conviction: 99,
    diamondHands: 92,
    paperHands: 8,
    degenerateScore: 98,
    profit: 14205,
    missedProfit: 420690,
    firstBuy: "2020-03-12",
    averageHold: "2.4 months",
    trades: 8522,
    ansemStatus: "HOLDER",
    badge: "The Legend",
    roast: "Wait, you're literally roasting Ansem? Bro, you're the one who called SOL at $8, fumbled WIF at $0.001 but somehow made it up by hosting 24/7 X Spaces while everyone else is sleeping. Your wallet is literally Solana royalty, but why is there 45,000 USDC sitting in a random pump.fun dev rug coin? Absolute king of the degens.",
    timeline: [
      { title: "Called SOL at $8", description: "Absolute gigachad move, conviction through the roof", type: "buy", date: "2022-12-15", icon: "Flame" },
      { title: "WIF Buy Order", description: "First buy of the hat coin at sub-penny prices", type: "buy", date: "2023-11-21", icon: "TrendingUp" },
      { title: "4 AM Space Session", description: "Hosted 6000 people talking about cat coins", type: "neutral", date: "2024-03-05", icon: "Radio" },
      { title: "Profit Take +12,400%", description: "Legendary run on WIF, bag secured", type: "profit", date: "2024-04-12", icon: "DollarSign" },
      { title: "Still Holding SOL", description: "Unshakable multi-cycle conviction", type: "hold", date: "2026-07-07", icon: "Shield" }
    ]
  },
  "blknoiz06": {
    walletIQ: 160,
    conviction: 100,
    diamondHands: 95,
    paperHands: 5,
    degenerateScore: 99,
    profit: 18920,
    missedProfit: 550000,
    firstBuy: "2019-11-18",
    averageHold: "3.1 months",
    trades: 11200,
    ansemStatus: "HOLDER",
    badge: "The Host",
    roast: "Ansem's main account detected. Look Chad, we all know you cook. You've printed millions on Bonk, WIF, and POPCAT. But please explain why you still have 12 pages of failed pump.fun dev migrations on your secondary accounts? Go get some sleep, drink some water, and turn off the microphone.",
    timeline: [
      { title: "Bitcoin Bottom Buy", description: "Accumulated early, true cycle builder", type: "buy", date: "2020-03-15", icon: "Flame" },
      { title: "Solana Giant Bid", description: "Conviction at $1.50, rode it to the top", type: "buy", date: "2020-12-04", icon: "TrendingUp" },
      { title: "Bonk Initial Buy", description: "Claimed the airdrop and bought more, peak Chad", type: "profit", date: "2022-12-25", icon: "DollarSign" },
      { title: "Popcat Hype", description: "Pushed POPCAT to new dimensions", type: "hold", date: "2024-01-18", icon: "Shield" }
    ]
  }
};

// Generate deterministic roast based on stats if Gemini fails
function getFallbackRoast(wallet: string, stats: any): string {
  const shortWallet = wallet.slice(0, 6) + "..." + wallet.slice(-4);
  if (stats.walletIQ < 60) {
    return `Bro, wallet ${shortWallet} is an absolute disaster. With a Wallet IQ of ${Math.round(stats.walletIQ)} and a degenerate score of ${Math.round(stats.degenerateScore)}%, you are literally exit liquidity. Your average hold time of ${stats.averageHold} proves you have the attention span of a goldfish on espresso. You probably bought the pump.fun top and got rugged in 30 seconds. Put the SOL down and go back to a 9-to-5, fr.`;
  } else if (stats.badge === "Pump.fun Addict") {
    return `Wallet ${shortWallet} is a certified Pump.fun Addict. You've traded ${stats.trades} times and average holding for ${stats.averageHold}. Your first buy was on ${stats.firstBuy}, and since then, you've done nothing but feed dev rug projects. You missed out on ${Math.round(stats.missedProfit)} SOL in profit because you keep selling your winners to buy 'PEPE69420DOG'. Get help, chat.`;
  } else if (stats.badge === "Paper Hands") {
    return `Oh look, a professional fumbler. Wallet ${shortWallet} has a Paper Hands rating of ${Math.round(stats.paperHands)}%. You fumbled ${Math.round(stats.missedProfit)} SOL in potential gains because you jeetted out of your positions after a 5% drop. Ansem would look at your portfolio, shake his head, and mute you on X. Hold something for more than ${stats.averageHold} for once in your life.`;
  } else {
    return `Wallet ${shortWallet} is cooking some mid-curve action. Your Wallet IQ is ${Math.round(stats.walletIQ)}, which is slightly above room temperature. You've made ${Math.round(stats.profit)} SOL but fumbled ${Math.round(stats.missedProfit)} SOL. You're holding some ANSEM status (${stats.ansemStatus}), but you're still trading like you have a 4 AM space brain. Stop FOMOing into green candles!`;
  }
}

// POST API for analyzing wallet
app.post("/api/analyze", async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet || typeof wallet !== "string") {
      return res.status(400).json({ error: "Wallet address is required" });
    }

    const cleanWallet = wallet.trim().toLowerCase();

    // Check easter eggs
    if (EASTER_EGGS[cleanWallet]) {
      return res.json({ ...EASTER_EGGS[cleanWallet], wallet });
    }

    // Generate deterministic metrics based on wallet address
    const seed = hashCode(cleanWallet);
    const rng = new SeededRandom(seed);

    const walletIQ = rng.range(35, 145);
    const degenerateScore = rng.range(60, 99);
    const diamondHands = rng.range(10, 95);
    const paperHands = 100 - diamondHands;
    const conviction = rng.range(5, 99);
    
    // Profit ranges
    const isProfitable = rng.next() > 0.45;
    const profitMultiplier = rng.range(5, 120);
    const profit = isProfitable ? rng.range(10, 2500) : -rng.range(5, 450);
    const missedProfit = rng.range(50, 15000);

    const trades = Math.round(rng.range(15, 2450));
    
    // Hold times
    const holdTimes = ["12 seconds", "3 minutes", "45 minutes", "2 hours", "6 hours", "1.5 days", "4.2 days", "2 weeks", "3.5 months", "1 year"];
    const averageHold = rng.choice(holdTimes);

    // First buy dates
    const years = [2021, 2022, 2023, 2024, 2025, 2026];
    const firstBuyYear = rng.choice(years);
    const firstBuyMonth = String(Math.floor(rng.range(1, 12))).padStart(2, "0");
    const firstBuyDay = String(Math.floor(rng.range(1, 28))).padStart(2, "0");
    const firstBuy = `${firstBuyYear}-${firstBuyMonth}-${firstBuyDay}`;

    // ANSEM status (deterministically 40% are holders)
    const hasAnsem = rng.next() > 0.6;
    const ansemStatus = hasAnsem ? "HOLDER" : "NO ANSEM FOUND";

    // Badge choice
    const badges = [
      "Diamond Hands",
      "Paper Hands",
      "Whale",
      "Smart Money",
      "Rug Collector",
      "Top Buyer",
      "Exit Liquidity",
      "Pump.fun Addict"
    ];
    let badge = rng.choice(badges);
    if (diamondHands > 80) badge = "Diamond Hands";
    else if (paperHands > 75) badge = "Paper Hands";
    else if (profit > 1200) badge = "Whale";
    else if (walletIQ > 120 && profit > 300) badge = "Smart Money";
    else if (walletIQ < 50) badge = "Exit Liquidity";

    // Generate custom timeline based on seed
    const timelineItems = [
      {
        title: "First Solana Swap",
        description: `Bought a random meme coin with high hopes at ${firstBuy}`,
        type: "buy",
        date: firstBuy,
        icon: "TrendingUp"
      },
      {
        title: "ANSEM Space Call FOMO",
        description: hasAnsem 
          ? "Heard Ansem talking about conviction on X Spaces. Instantly bought the bid." 
          : "Missed Ansem's 3 AM spaces, bought the top of some derivative coin instead.",
        type: hasAnsem ? "buy" : "loss",
        date: "2024-03-12",
        icon: "Radio"
      },
      {
        title: "Pump.fun Era Launch",
        description: badge === "Pump.fun Addict" 
          ? `Apelled into ${Math.round(rng.range(5, 50))} pump.fun launches in a single day.`
          : "Traded multiple instant-launches. Some rugged, some did 2x.",
        type: "neutral",
        date: "2024-09-08",
        icon: "Flame"
      },
      {
        title: "The Ultimate Fumble",
        description: `Sold a winning coin early right before it did a 50x. Missed out on ~${Math.round(missedProfit * 0.7)} SOL.`,
        type: "loss",
        date: "2025-01-14",
        icon: "Frown"
      },
      {
        title: "Current Portfolio State",
        description: profit > 0 
          ? `Secured a net profit of +${Math.round(profit)} SOL. Cooking premium gains.` 
          : `Sitting on a net loss of ${Math.round(profit)} SOL. Living on ramen noodles.`,
        type: profit > 0 ? "profit" : "loss",
        date: "2026-07-07",
        icon: "DollarSign"
      }
    ];

    // Build the stats block
    const stats = {
      wallet,
      walletIQ: Math.round(walletIQ),
      conviction: Math.round(conviction),
      diamondHands: Math.round(diamondHands),
      paperHands: Math.round(paperHands),
      degenerateScore: Math.round(degenerateScore),
      profit: parseFloat(profit.toFixed(2)),
      missedProfit: Math.round(missedProfit),
      firstBuy,
      averageHold,
      trades,
      ansemStatus,
      badge,
      timeline: timelineItems,
    };

    // Call Gemini API for a premium roast!
    const ai = getGeminiClient();
    let roast = "";

    if (ai) {
      try {
        const prompt = `You are Ansem (@blknoiz06), the legendary high-energy Solana crypto Twitter influencer. 
Roast the Solana wallet address "${wallet}" based on these detemined stats:
- Wallet IQ: ${stats.walletIQ} (out of 150)
- Degenerate Score: ${stats.degenerateScore}%
- Diamond Hands: ${stats.diamondHands}%
- Paper Hands: ${stats.paperHands}%
- Badge Awarded: "${stats.badge}"
- ANSEM Token Status: ${stats.ansemStatus}
- Net Profit/Loss: ${stats.profit} SOL
- Missed Profit (Fumbled Gains): ${stats.missedProfit} SOL
- Total Trades: ${stats.trades}
- Average Hold Time: ${stats.averageHold}
- First Trade: ${stats.firstBuy}

Write a direct, hilarious, hyper-realistic, short and snappy roast in Ansem's authentic style. 
Use crypto slang like "cook", "jeeting", "midcurve", "spaces", "fumbled the bag fr", "absolute dev rug", "cooked", "send it", "on god", "WIF", "pump.fun", "exit liquidity".
Be highly opinionated and address the user as "bro" or "chad". Keep it to 3 to 4 paragraphs. Make it punchy, aggressive, and incredibly entertaining. Keep formatting clean with no markdown headers.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
        });

        if (response.text) {
          roast = response.text.trim();
        } else {
          roast = getFallbackRoast(wallet, stats);
        }
      } catch (aiError) {
        console.error("Gemini roast generation failed, using fallback:", aiError);
        roast = getFallbackRoast(wallet, stats);
      }
    } else {
      console.log("No Gemini API key config or key is default. Using fallback roast.");
      roast = getFallbackRoast(wallet, stats);
    }

    res.json({
      ...stats,
      roast,
    });
  } catch (err: any) {
    console.error("API Error in analyze:", err);
    res.status(500).json({ error: "Internal server error occurred while scanning." });
  }
});

// Serve frontend assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Ansem Wallet Roast server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
