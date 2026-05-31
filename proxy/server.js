/**
 * 腾讯 TMT 翻译代理 — 桥接浏览器端到腾讯云 API
 * 启动: npm install && npm start
 * 默认端口 3001，浏览器端配置 proxyUrl: 'http://localhost:3001/tmt'
 */
const express = require('express');
const tencentcloud = require('tencentcloud-sdk-nodejs-tmt');
const TmtClient = tencentcloud.tmt.v20180321.Client;

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS 允许本地页面访问
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.post('/tmt', async (req, res) => {
    const { texts, source, target, secretId, secretKey, region } = req.body;

    if (!texts || !texts.length) return res.json({ translations: [] });
    if (!secretId || !secretKey) {
        return res.status(400).json({ error: '请配置 secretId 和 secretKey' });
    }

    try {
        const client = new TmtClient({
            credential: { secretId, secretKey },
            region: region || 'ap-guangzhou',
            profile: { httpProfile: { endpoint: 'tmt.tencentcloudapi.com' } }
        });

        const result = await client.TextTranslate({
            SourceText: texts.join('\n'),
            Source: source || 'auto',
            Target: target || 'zh',
            ProjectId: 0
        });

        const translations = (result.TargetText || '').split('\n');
        console.log(`[TMT] ${texts.length} texts → ${translations.length} translations`);
        res.json({ translations });
    } catch (err) {
        console.error('[TMT] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🔄 TMT 翻译代理已启动: http://localhost:${PORT}/tmt`);
    console.log('   在 js/spine-loading.js 的 TMT_CONFIG 中配置 secretId/secretKey/proxyUrl');
});
