const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const RELAY_PORT = 9000;

function loadLedger() {
    const ledgerPath = path.join(__dirname, '../../ledger/mock-ledger.json');
    if (fs.existsSync(ledgerPath)) {
        return JSON.parse(fs.readFileSync(ledgerPath));
    }
    return {};
}

http.createServer((req, res) => {
    console.log(`Relay: received request for ${req.url}`);

    if (req.url.includes('favicon.ico')) {
        res.writeHead(204).end();
        return;
    }

    const parsed = url.parse(req.url, true);
    const originalUrl = parsed.query.original;

    if (!originalUrl) {
        res.writeHead(400).end('Missing original URL');
        return;
    }

    const target = url.parse(originalUrl);
    const targetHost = target.hostname;
    const targetPath = target.path;

    console.log(`Forwarding to https://${targetHost}${targetPath}`);

    const ledger = loadLedger();

    const proxy = https.request({
        hostname: targetHost,
        port: 443,
        path: targetPath,
        method: req.method,
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9'
        },
        checkServerIdentity: (hostname, cert) => {
            const fingerprint = cert.fingerprint256;
            console.log(`✅ Server cert fingerprint: ${fingerprint}`);
            if (ledger[targetHost] !== fingerprint) {
                console.error('❌ Cert fingerprint mismatch!');
                return new Error('Forbidden: cert fingerprint mismatch');
            }
            return null;
        }
    }, proxiedRes => {
        res.writeHead(proxiedRes.statusCode, proxiedRes.headers);
        proxiedRes.pipe(res, { end: true });
    });

    proxy.on('error', err => {
        console.error('Relay error:', err.message);
        if (!res.headersSent) {
            if (err.message.includes('fingerprint')) {
                res.writeHead(403).end('Forbidden: cert fingerprint mismatch');
            } else {
                res.writeHead(500).end('Relay error');
            }
        }
    });

    req.pipe(proxy, { end: true });

}).listen(RELAY_PORT, () => {
    console.log(`🚀 Relay listening on port ${RELAY_PORT}`);
});
