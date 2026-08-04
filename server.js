const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

const PORT = process.env.PORT || 4545;

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    try {
        const urlParams = new URL(req.url, `http://${req.headers.host}`);

        // 1. Fetch details using public Invidious instance API
        if (urlParams.pathname === '/ytdetails') {
            const ytUrl = urlParams.searchParams.get('url');
            let videoId = '';
            if (ytUrl.includes('youtu.be/')) videoId = ytUrl.split('youtu.be/')[1]?.split('?')[0];
            else if (ytUrl.includes('watch?v=')) videoId = new URLSearchParams(ytUrl.split('?')[1]).get('v');
            else if (ytUrl.includes('live/')) videoId = ytUrl.split('live/')[1]?.split('?')[0];

            try {
                const apiData = await fetchJson(`https://invidious.privacyredirect.com/api/v1/videos/${videoId}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    title: apiData.title || "YouTube Stream",
                    duration: apiData.lengthSeconds || 0,
                    qualities: ['720p', '360p']
                }));
            } catch (e) {
                res.writeHead(500).end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // 2. Stream using direct video stream source
        if (urlParams.pathname === '/yt') {
            const ytUrl = urlParams.searchParams.get('url');
            let videoId = '';
            if (ytUrl.includes('youtu.be/')) videoId = ytUrl.split('youtu.be/')[1]?.split('?')[0];
            else if (ytUrl.includes('watch?v=')) videoId = new URLSearchParams(ytUrl.split('?')[1]).get('v');
            else if (ytUrl.includes('live/')) videoId = ytUrl.split('live/')[1]?.split('?')[0];

            try {
                const apiData = await fetchJson(`https://invidious.privacyredirect.com/api/v1/videos/${videoId}`);
                // Find best adaptive stream or fallback format url
                const streamUrl = apiData.formatStreams?.[0]?.url || apiData.adaptiveFormats?.find(f => f.type?.includes('video/mp4'))?.url;
                
                if (!streamUrl) throw new Error('Stream URL not found');

                const args = [
                    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
                    '-i', streamUrl,
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
                    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
                    '-f', 'mp4', 'pipe:1'
                ];

                res.writeHead(200, { 'Content-Type': 'video/mp4', 'Access-Control-Allow-Origin': '*' });
                const ffmpegProcess = spawn(ffmpegStatic, args);
                ffmpegProcess.stdout.pipe(res);
                ffmpegProcess.on('error', () => res.end());
                req.on('close', () => { try { ffmpegProcess.kill('SIGKILL'); } catch (e) {} });

            } catch (e) {
                res.writeHead(500).end(e.message);
            }
            return;
        }

        res.writeHead(404).end('Route not found');
    } catch (e) {
        res.writeHead(500).end();
    }
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
