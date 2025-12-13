
async function checkVolumes() {
    const pairs = ['SOLUSDT', 'ADAUSDT', 'SUIUSDT', 'ETHUSDT', 'DOGEUSDT'];
    console.log('Fetching live volumes for:', pairs.join(', '));

    try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
        const data = await res.json();

        console.log('\nPair        | Quote Volume ($)     | > 50M?');
        console.log('-'.repeat(45));

        pairs.forEach(pair => {
            const ticker = data.find(t => t.symbol === pair);
            if (ticker) {
                const vol = parseFloat(ticker.quoteVolume);
                const millions = (vol / 1000000).toFixed(2) + 'M';
                const pass = vol >= 50000000 ? '✅ YES' : '❌ NO';

                console.log(`${pair.padEnd(11)} | ${millions.padEnd(20)} | ${pass}`);
            }
        });

    } catch (e) {
        console.error(e);
    }
}

checkVolumes();
