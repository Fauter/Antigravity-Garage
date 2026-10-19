const http = require('http');
const fs = require('fs');
const path = require('path');

// Extract the function from main.js to test it exactly as written
const mainPath = path.join(__dirname, 'main.js');
const mainContent = fs.readFileSync(mainPath, 'utf8');
const match = mainContent.match(/function waitForBackendReady[^\{]+\{[\s\S]*?\n\s*\};?\n\s*check\(\);\n\s*}\);\n}/m);

if (!match) {
    console.error("Could not extract waitForBackendReady from main.js");
    process.exit(1);
}

// Evaluate the function in this context
eval(match[0]);

async function runTest(name, serverLogic, options) {
    console.log(`\n=== Running Test: ${name} ===`);
    
    // Create a mock server
    const server = http.createServer(serverLogic);
    
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    
    try {
        const start = Date.now();
        await waitForBackendReady(port, options);
        const duration = Date.now() - start;
        console.log(`✅ PASS: ${name} (Resolved in ${duration}ms)`);
        server.close();
        return true;
    } catch (err) {
        console.log(`❌ FAIL/TIMEOUT: ${name} (${err.message})`);
        server.close();
        return false;
    }
}

async function runAllTests() {
    // 1. 100 ms -> PASS
    await runTest('100ms response', (req, res) => {
        setTimeout(() => { res.writeHead(200); res.end('{"ok":true}'); }, 100);
    }, { overallTimeoutMs: 5000, requestTimeoutMs: 5000, retryIntervalMs: 100, endpoint: '/' });

    // 2. 400 ms -> PASS
    await runTest('400ms response', (req, res) => {
        setTimeout(() => { res.writeHead(200); res.end('{"ok":true}'); }, 400);
    }, { overallTimeoutMs: 5000, requestTimeoutMs: 5000, retryIntervalMs: 100, endpoint: '/' });

    // 3. 750 ms -> PASS (This explicitly proves the bug is fixed! Old bug would fail here)
    await runTest('750ms response', (req, res) => {
        setTimeout(() => { res.writeHead(200); res.end('{"ok":true}'); }, 750);
    }, { overallTimeoutMs: 5000, requestTimeoutMs: 5000, retryIntervalMs: 100, endpoint: '/' });

    // 4. 1500 ms -> PASS
    await runTest('1500ms response', (req, res) => {
        setTimeout(() => { res.writeHead(200); res.end('{"ok":true}'); }, 1500);
    }, { overallTimeoutMs: 5000, requestTimeoutMs: 5000, retryIntervalMs: 100, endpoint: '/' });

    // 5. 4000 ms -> PASS
    await runTest('4000ms response', (req, res) => {
        setTimeout(() => { res.writeHead(200); res.end('{"ok":true}'); }, 4000);
    }, { overallTimeoutMs: 6000, requestTimeoutMs: 5000, retryIntervalMs: 100, endpoint: '/' });

    // 6. > requestTimeout -> timeout + retry
    // In this test, the server takes 1500ms, but requestTimeout is 500ms.
    // So the request will be destroyed. We make it succeed on the 3rd attempt by answering in 100ms.
    let attempt = 0;
    await runTest('Greater than requestTimeout (Retry logic)', (req, res) => {
        attempt++;
        if (attempt < 3) {
            setTimeout(() => { res.writeHead(200); res.end('{"ok":true}'); }, 1500); // Too slow
        } else {
            setTimeout(() => { res.writeHead(200); res.end('{"ok":true}'); }, 100);  // Fast
        }
    }, { overallTimeoutMs: 5000, requestTimeoutMs: 500, retryIntervalMs: 100, endpoint: '/' });

    // 7. Backend starts late (ECONNREFUSED initially)
    let requestsReceived = 0;
    console.log(`\n=== Running Test: Backend starts late ===`);
    const lateServer = http.createServer((req, res) => {
        requestsReceived++;
        res.writeHead(200); res.end('{"ok":true}');
    });
    
    // We bind it AFTER 2 seconds
    const targetPort = 31337;
    setTimeout(() => {
        lateServer.listen(targetPort, '127.0.0.1');
    }, 2000);
    
    try {
        const start = Date.now();
        await waitForBackendReady(targetPort, { overallTimeoutMs: 5000, requestTimeoutMs: 1000, retryIntervalMs: 500, endpoint: '/' });
        console.log(`✅ PASS: Backend starts late (Resolved in ${Date.now() - start}ms)`);
    } catch (e) {
        console.log(`❌ FAIL: Backend starts late (${e.message})`);
    } finally {
        lateServer.close();
    }
}

runAllTests().catch(console.error);
