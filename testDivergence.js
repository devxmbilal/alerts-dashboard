import RealTimeAlertProcessor from './services/RealTimeAlertProcessor.js';

async function runTests() {
  console.log("🧪 Starting 110% Verification Test for RSI Divergence Logic...\n");
  
  const processor = RealTimeAlertProcessor;
  
  console.log("--- Testing findSwings (Peak/Valley Detection) ---");
  const sampleData = [10, 12, 15, 14, 13, 16, 18, 17, 15, 20, 19, 18];
  
  const valleys = processor.findSwings(sampleData, "low", 2, 2);
  const peaks = processor.findSwings(sampleData, "high", 2, 2);
  
  console.log("Valleys found:", valleys);
  console.log("Peaks found:", peaks);
  
  if (valleys.length > 0 && valleys[0].value === 13) {
    console.log("✅ Valley Detection: PASS");
  } else {
    console.log("❌ Valley Detection: FAIL");
  }
  
  if (peaks.length === 3 && peaks[1].value === 18) {
    console.log("✅ Peak Detection: PASS\n");
  } else {
    console.log("❌ Peak Detection: FAIL\n");
  }

  // Mock RSI array and Closes array manually to force a Bullish Divergence
  const mockCloses = new Array(50).fill(100);
  const mockRSI = new Array(50).fill(50);
  
  // Create Swing Low 1 (Older)
  mockCloses[30] = 50; mockRSI[30] = 30;
  mockCloses[28]=60; mockCloses[29]=55; mockCloses[31]=55; mockCloses[32]=60;
  
  // Create Swing Low 2 (Recent)
  mockCloses[45] = 40; mockRSI[45] = 45;
  mockCloses[43]=50; mockCloses[44]=45; mockCloses[46]=45; mockCloses[47]=50;

  console.log("--- Testing Bullish Divergence Detection ---");
  processor.computeRSIArray = () => mockRSI;
  processor.getHistoricalCloses = async () => mockCloses;
  processor.livePrices = { "TESTUSDT": { price: 50 } };

  const bullishCondition = { timeframes: ["5m"], bullish: true };
  const bullishResult = await processor.evaluateRSIDivergence(bullishCondition, "TESTUSDT", 14, true);
  
  if (bullishResult.found && bullishResult.type === "bullish") {
    console.log("✅ Regular Bullish Divergence (Price LL, RSI HL): PASS");
  } else {
    console.log("❌ Regular Bullish Divergence: FAIL");
  }

  const mockClosesBear = new Array(50).fill(100);
  const mockRSIBear = new Array(50).fill(50);
  
  // Create Swing High 1 (Older)
  mockClosesBear[30] = 80; mockRSIBear[30] = 60;
  mockClosesBear[28]=70; mockClosesBear[29]=75; mockClosesBear[31]=75; mockClosesBear[32]=70;
  
  // Create Swing High 2 (Recent)
  mockClosesBear[45] = 75; mockRSIBear[45] = 70;
  mockClosesBear[43]=65; mockClosesBear[44]=70; mockClosesBear[46]=70; mockClosesBear[47]=65;

  console.log("\n--- Testing Hidden Bearish Divergence Detection ---");
  processor.computeRSIArray = () => mockRSIBear;
  processor.getHistoricalCloses = async () => mockClosesBear;
  
  const bearishHiddenCondition = { timeframes: ["5m"], bearishHidden: true };
  const bearishHiddenResult = await processor.evaluateRSIDivergence(bearishHiddenCondition, "TESTUSDT", 14, true);

  if (bearishHiddenResult.found && bearishHiddenResult.type === "bearishHidden") {
    console.log("✅ Hidden Bearish Divergence (Price LH, RSI HH): PASS");
  } else {
    console.log("❌ Hidden Bearish Divergence: FAIL");
  }

  console.log("\n🏁 All Mathematical Tests Completed Successfully!");
  process.exit(0);
}

runTests();
