const http = require('http');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const youtubedl = require('youtube-dl-exec'); 

const PORT = process.env.PORT || 4545;

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

        // 1. Fetch YT Details & Qualities
        if (urlParams.pathname === '/ytdetails') {
            const ytUrl = urlParams.searchParams.get('url');
            try {
                const info = await youtubedl(ytUrl, { 
                    dumpSingleJson: true, noWarnings: true, noCallHome: true, noCheckCertificates: true,
                    geoBypass: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                });
                
                let qualities = [];
                if (info.formats) {
                    info.formats.forEach(f => {
                        if (f.vcodec !== 'none' && f.height) {
                            const q = f.height + 'p';
                            if (!qualities.includes(q)) qualities.push(q);
                        }
                    });
                }
                qualities.sort((a, b) => parseInt(b) - parseInt(a));

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    title: info.title || "YouTube Video",
                    duration: info.duration || 0,
                    qualities: qualities.length ? qualities : ['720p', '360p']
                }));
            } catch (e) {
                res.writeHead(500).end(JSON.stringify({ error: e.message }));
            }
            return;
        }

        // 2. YT Stable Streamer Engine
        if (urlParams.pathname === '/yt') {
            const ytUrl = urlParams.searchParams.get('url');
            const qualityLabel = urlParams.searchParams.get('quality') || '720p';
            const seekTime = parseFloat(urlParams.searchParams.get('start') || '0');

            try {
                const info = await youtubedl(ytUrl, { 
                    dumpSingleJson: true, noWarnings: true, noCallHome: true, noCheckCertificates: true,
                    geoBypass: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                });
                
                const targetHeight = parseInt(qualityLabel);
                
                const videoFormats = info.formats.filter(f => f.vcodec !== 'none' && f.height === targetHeight);
                let videoFormat = videoFormats.sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];
                if (!videoFormat) {
                    videoFormat = info.formats.filter(f => f.vcodec !== 'none').sort((a, b) => (b.height || 0) - (b.height || 0))[0];
                }

                const audioFormats = info.formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none');
                let audioFormat = audioFormats.sort((a, b) => (b.abr || 0) - (b.abr || 0))[0];
                if (!audioFormat) {
                    audioFormat = info.formats.find(f => f.acodec !== 'none');
                }

                const args = [];
                args.push('-analyzeduration', '500000', '-probesize', '1000000');

                if (audioFormat && audioFormat.url && videoFormat && videoFormat.url && audioFormat.url !== videoFormat.url) {
                    if (seekTime > 0) args.push('-ss', seekTime.toString());
                    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', videoFormat.url);
                    
                    if (seekTime > 0) args.push('-ss', seekTime.toString());
                    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', audioFormat.url);
                    
                    args.push('-map', '0:v:0', '-map', '1:a:0');
                } else if (videoFormat && videoFormat.url) {
                    if (seekTime > 0) args.push('-ss', seekTime.toString());
                    args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', videoFormat.url);
                    args.push('-map', '0:v:0', '-map', '0:a:0?');
                } else {
                    throw new Error('No valid media stream found');
                }

                args.push(
                    '-c:v', 'copy', 
                    '-c:a', 'aac', '-b:a', '128k',
                    '-muxdelay', '0', '-muxpreload', '0', 
                    '-fflags', '+genpts',
                    '-avoid_negative_ts', 'make_zero',
                    '-threads', '0', 
                    '-max_muxing_queue_size', '9999', 
                    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
                    '-f', 'mp4', 'pipe:1'
                );

                res.writeHead(200, { 'Content-Type': 'video/mp4', 'Access-Control-Allow-Origin': '*' });
                const ffmpegProcess = spawn(ffmpegStatic, args);
                ffmpegProcess.stdout.pipe(res);
                ffmpegProcess.on('error', (err) => res.end());
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

server.listen(PORT, () => console.log(`Cloud Server running on port ${PORT}`));
