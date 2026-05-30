/* ================================================================
   Spine 双运行时加载器 (3.8 + 4.2 + 4.3)
   通过 CDN 加载三个版本的 spine-webgl，并存到不同命名空间:
     window.spine38 / window.spine42 / window.spine43
   加载完成后触发 window._onSpineReady 回调
   ================================================================ */

(function () {
    // CDN 地址
    var CDN_38 = 'https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.8/spine-ts/build/spine-webgl.js';
    var CDN_38_FALLBACK = 'https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/3.8/spine-ts/build/spine-webgl.js';
    var CDN_42 = 'https://unpkg.com/@esotericsoftware/spine-webgl@4.2.100/dist/iife/spine-webgl.js';
    var CDN_43 = 'https://unpkg.com/@esotericsoftware/spine-webgl@4.3.2/dist/iife/spine-webgl.js';

    function loadScript(url) {
        return new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = url;
            s.onload = function () {
                console.log('[Spine] Loaded:', url);
                resolve(url);
            };
            s.onerror = function () {
                console.warn('[Spine] Failed:', url);
                reject(url);
            };
            document.head.appendChild(s);
        });
    }

    function tryLoad(url, fallback) {
        return loadScript(url).catch(function () {
            return fallback ? loadScript(fallback) : Promise.reject('all failed');
        });
    }

    console.log('[Spine] Loading spine-webgl 3.8...');
    tryLoad(CDN_38, CDN_38_FALLBACK)
        .then(function () {
            window.spine38 = window.spine;
            console.log('[Spine] spine-webgl 3.8 ready ✓ (saved as spine38)');

            console.log('[Spine] Loading spine-webgl 4.2...');
            return loadScript(CDN_42);
        })
        .then(function () {
            window.spine42 = window.spine;
            console.log('[Spine] spine-webgl 4.2 ready ✓ (saved as spine42)');

            console.log('[Spine] Loading spine-webgl 4.3...');
            return loadScript(CDN_43);
        })
        .then(function () {
            window.spine43 = window.spine;
            // 恢复 3.8 作为默认版本（向后兼容）
            window.spine = window.spine38;
            console.log('[Spine] spine-webgl 4.3 ready ✓ (saved as spine43)');
            console.log('[Spine] Triple runtime ready: 3.8 + 4.2 + 4.3');

            var sb = document.getElementById('sbStatus');
            if (sb) sb.textContent = 'Spine 3.8 + 4.2 + 4.3 ✓';

            if (window._onSpineReady) window._onSpineReady();
        })
        .catch(function (err) {
            console.error('[Spine] Failed to load dual runtime:', err);
            var sb = document.getElementById('sbStatus');
            if (sb) {
                if (window.spine38) {
                    sb.textContent = 'Spine 3.8 only (4.3 failed)';
                } else {
                    sb.textContent = '⚠️ Spine not loaded';
                }
            }
            if (window._onSpineReady) window._onSpineReady();
        });
})();
