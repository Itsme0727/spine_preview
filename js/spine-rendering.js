/* ================================================================
   Spine 渲染 — WebGL 设置 & 渲染循环
   负责: 3.8/4.x WebGL 上下文创建、每帧 skeleton 渲染、视口变换
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 视口坐标转换 ----
SMTool.worldToCanvas = function (wx, wy) {
    var z = SMData.view.zoom;
    return {
        x: (wx + SMData.view.x) * z + window.innerWidth / 2,
        y: (wy + SMData.view.y) * z + window.innerHeight / 2
    };
};

SMTool.canvasToWorld = function (sx, sy) {
    var z = SMData.view.zoom;
    return {
        x: (sx - window.innerWidth / 2) / z - SMData.view.x,
        y: (sy - window.innerHeight / 2) / z - SMData.view.y
    };
};

SMTool.worldToDOM = function (wx, wy) {
    return SMTool.worldToCanvas(wx, wy);
};

// ---- WebGL 渲染器设置 (3.8 barebones 或 4.x SceneRenderer) ----
SMTool._setupWebGLRenderer = function (node, SP, WGL, atlas, img, useVer) {
    var sk = node.skeleton;
    var physParam = node._physParam;

    // 清理旧资源
    if (node.batcher) { try { node.batcher.dispose(); } catch (e) {} }
    if (node.shader) { try { node.shader.dispose(); } catch (e) {} }
    if (node.sceneRenderer) { try { node.sceneRenderer.dispose(); } catch (e) {} node.sceneRenderer = null; }
    if (node.glTextures) {
        node.glTextures.forEach(function (t) { try { t.dispose(); } catch (e) {} });
    }
    node.glTextures = [];

    // 计算边界
    sk.setToSetupPose();
    sk.updateWorldTransform(physParam);
    var boundsOff = new SP.Vector2();
    var boundsSize = new SP.Vector2();
    try {
        if (typeof sk.getBounds === 'function') {
            sk.getBounds(boundsOff, boundsSize, []);
        } else {
            SMTool._computeBoundsManually(sk, boundsOff, boundsSize);
        }
    } catch (e) {
        console.warn('[Spine] getBounds failed, using fallback:', e.message);
        SMTool._computeBoundsManually(sk, boundsOff, boundsSize);
    }
    node.bounds = { offset: boundsOff, size: boundsSize };

    var pad = Math.max(100, Math.ceil(Math.max(boundsSize.x, boundsSize.y) * 0.4));
    var cw = Math.max(400, Math.ceil(boundsSize.x) + pad * 2);
    var ch = Math.max(400, Math.ceil(boundsSize.y) + pad * 2);
    console.log('[Spine] Canvas: ' + cw + 'x' + ch + ', bounds: ' + boundsSize.x.toFixed(0) + 'x' + boundsSize.y.toFixed(0));

    // 获取/创建 Canvas
    var nodeEl = SMTool._getEl(node.id);
    if (!nodeEl) { console.warn('[Spine] Node #' + node.id + ' DOM not found, skip canvas'); return; }
    var wrap = nodeEl.querySelector('.spine-canvas-wrap');
    if (!wrap) { console.warn('[Spine] canvas-wrap not found for #' + node.id); return; }

    var oldC = wrap.querySelector('canvas:not(.bone-mark-overlay)');
    if (oldC) oldC.remove();
    var oldOv = wrap.querySelector('.bone-mark-overlay');
    if (oldOv) oldOv.remove();
    var ph = wrap.querySelector('div');
    if (ph) ph.remove();

    var canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvas.style.display = 'block';
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    wrap.appendChild(canvas);

    // 创建骨骼标记叠加画布（透明，在 Spine 画布上方）
    var overlay = document.createElement('canvas');
    overlay.width = cw;
    overlay.height = ch;
    overlay.className = 'bone-mark-overlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;width:' + cw + 'px;height:' + ch + 'px;pointer-events:none;display:block';
    wrap.appendChild(overlay);
    node._boneOverlay = overlay;
    node._boneOverlayCtx = overlay.getContext('2d');

    node.canvas = canvas;
    node.width = Math.max(cw + 10, node.width, 260);
    node._canvasWidth = cw;
    node._canvasHeight = ch;
    // 同步 DOM 最小宽度，确保面板适配画布
    if (nodeEl) nodeEl.style.minWidth = node.width + 'px';

    // 监听 WebGL 上下文丢失（真实浏览器在大量上下文时可能触发）
    canvas.addEventListener('webglcontextlost', function (ev) {
        console.warn('[Spine] WebGL context LOST for node #' + node.id + ' — will try to restore');
        ev.preventDefault(); // 允许后续恢复
        node._glLost = true;
    });
    canvas.addEventListener('webglcontextrestored', function () {
        console.log('[Spine] WebGL context RESTORED for node #' + node.id);
        node._glLost = false;
        // 上下文恢复后需要重新创建所有 WebGL 资源
        // 这里标记后，下次渲染循环会尝试重新初始化
    });

    // 居中 Skeleton
    sk.x = cw / 2 - (boundsOff.x + boundsSize.x / 2);
    sk.y = ch / 2 - (boundsOff.y + boundsSize.y / 2);
    sk.updateWorldTransform(physParam);

    // 根据版本设置 WebGL
    try {
        if (useVer === '4.3' || useVer === '4.2') {
            SMTool._setupWebGL4x(node, SP, canvas, atlas, img, cw, ch);
        } else {
            // 3.8 路径：检查 WGL 是否已加载，未加载则延迟重试
            if (!WGL || !WGL.Shader) {
                console.warn('[Spine] WGL not ready for 3.8 node #' + node.id + ', will retry...');
                node._needsWebGLRetry = true;
                return;
            }
            SMTool._setupWebGL38(node, SP, WGL, canvas, atlas, img, cw, ch);
        }
    } catch (e) {
        console.error('[Spine] WebGL setup failed for node #' + node.id + ':', e.message);
        // 只有非「WGL 未就绪」的情况才永久标记失败
        if (!node._needsWebGLRetry) {
            if (node.canvas && node.canvas.parentNode) node.canvas.remove();
            node.canvas = null;
            node.gl = null;
            var fb = document.createElement('div');
            fb.style.cssText = 'color:#f55;padding:40px;text-align:center;font-size:13px';
            fb.textContent = '⚠ 渲染失败';
            if (wrap) wrap.appendChild(fb);
        }
    }
};

// ---- 4.x WebGL 设置 (SceneRenderer) ----
SMTool._setupWebGL4x = function (node, SP, canvas, atlas, img, cw, ch) {
    var context = new SP.ManagedWebGLRenderingContext(canvas, { alpha: false });
    node.gl = context.gl;

    var renderer = new SP.SceneRenderer(canvas, context, true);
    node.sceneRenderer = renderer;

    renderer.camera.position.set(cw / 2, ch / 2, 0);
    renderer.camera.viewportWidth = cw;
    renderer.camera.viewportHeight = ch;
    renderer.camera.update();

    for (var i = 0; i < atlas.pages.length; i++) {
        var page = atlas.pages[i];
        var glTex = new SP.GLTexture(context, img, page.pma || false);
        page.setTexture(glTex);
        node.glTextures.push(glTex);
    }
    for (var j = 0; j < atlas.regions.length; j++) {
        atlas.regions[j].texture = atlas.regions[j].page.texture;
    }
};

// ---- 3.8 WebGL 设置 (barebones) ----
SMTool._setupWebGL38 = function (node, SP, WGL, canvas, atlas, img, cw, ch) {
    var gl = canvas.getContext('webgl2', { alpha: false }) || canvas.getContext('webgl', { alpha: false });
    if (!gl) throw new Error('WebGL not available');
    node.gl = gl;

    node.shader = WGL.Shader.newTwoColoredTextured(gl);
    node.batcher = new WGL.PolygonBatcher(gl);
    node.mvp = new WGL.Matrix4();
    node.skeletonRenderer = new WGL.SkeletonRenderer(gl);
    node.mvp.ortho2d(0, 0, cw - 1, ch - 1);

    for (var i = 0; i < atlas.pages.length; i++) {
        var page = atlas.pages[i];
        try {
            var glTex = new WGL.GLTexture(gl, img, false);
            page.texture = glTex;
            node.glTextures.push(glTex);
        } catch (e) {
            console.warn('[Spine] GL texture failed:', e);
        }
    }
    for (var j = 0; j < atlas.regions.length; j++) {
        var region = atlas.regions[j];
        if (region.page && region.page.texture) region.texture = region.page.texture;
    }
};

// ---- 骨骼标记绘制（红色十字叉，实时跟随动画） ----
SMTool._drawBoneMarks = function (node, skeleton) {
    try {
        var overlay = node._boneOverlay;
        var ctx = node._boneOverlayCtx;
        if (!overlay || !ctx) return;

        var cw = overlay.width;
        var ch = overlay.height;
        if (cw <= 0 || ch <= 0) return;

        // 获取当前动画的标记骨骼集合
        var storeKey = (node.sourceFile || node.name) + '||' + (node.currentAnim || '');
        var marks = SMData._boneMarkStore[storeKey];
        if (!marks) { ctx.clearRect(0, 0, cw, ch); return; }

        var boneNames = Object.keys(marks);
        if (boneNames.length === 0) { ctx.clearRect(0, 0, cw, ch); return; }

        // 骨架在画布中的偏移
        var sx = (typeof skeleton.x === 'number') ? skeleton.x : 0;
        var sy = (typeof skeleton.y === 'number') ? skeleton.y : 0;

        // 检查 findBone 是否可用
        if (typeof skeleton.findBone !== 'function') { ctx.clearRect(0, 0, cw, ch); return; }

        // 清空上一帧
        ctx.clearRect(0, 0, cw, ch);

        for (var i = 0; i < boneNames.length; i++) {
            var bone = skeleton.findBone(boneNames[i]);
            if (!bone) continue;
            if (typeof bone.getWorldX !== 'function' || typeof bone.getWorldY !== 'function') continue;

            // 骨骼世界坐标 → 画布像素坐标（Spine Y 朝上，Canvas Y 朝下 → 翻转）
            var bx = sx + bone.getWorldX();
            var by = ch - (sy + bone.getWorldY());

            // 跳过画布外的点
            if (isNaN(bx) || isNaN(by)) continue;

            // 绘制红色十字叉
            var size = 8;
            ctx.save();
            ctx.strokeStyle = '#ff3333';
            ctx.lineWidth = 2;
            ctx.shadowColor = 'rgba(255,0,0,0.6)';
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.moveTo(bx - size, by);
            ctx.lineTo(bx + size, by);
            ctx.moveTo(bx, by - size);
            ctx.lineTo(bx, by + size);
            ctx.stroke();

            // 小圆点中心
            ctx.fillStyle = '#ff3333';
            ctx.shadowBlur = 0;
            ctx.beginPath();
            ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    } catch (e) {
        // 骨骼标记绘制失败不应影响主渲染循环
    }
};

// ---- 渲染循环 ----
SMTool._lt = 0;
SMTool._fc = 0;
SMTool._ft = 0;

SMTool._loop = function (now) {
    requestAnimationFrame(function (t) { SMTool._loop(t); });

    var dt = Math.min((now - SMTool._lt) / 1000, 0.1);
    SMTool._lt = now;
    SMTool._fc++;
    if (now - SMTool._ft >= 1000) {
        document.getElementById('sbFPS').textContent = 'FPS: ' + Math.round(SMTool._fc * 1000 / (now - SMTool._ft));
        SMTool._fc = 0;
        SMTool._ft = now;
    }

    var SP38 = window.spine38;
    var WGL38 = SP38 && SP38.webgl;

    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var node = result.value;
        if (!node.state || !node.skeleton) { result = nodesIter.next(); continue; }
        if (node._glLost || (node.gl && node.gl.isContextLost())) { result = nodesIter.next(); continue; }

        // WGL 延迟重试：首次初始化时 WGL 未就绪，每帧尝试完成 WebGL 设置
        if (node._needsWebGLRetry) {
            var WGLnow = window.spine38 && window.spine38.webgl;
            if (WGLnow && WGLnow.Shader && node.canvas && node.atlasData && node.textureImg) {
                try {
                    SMTool._setupWebGL38(node, node._SP, WGLnow, node.canvas, node.atlasData, node.textureImg, node._canvasWidth, node._canvasHeight);
                    node._needsWebGLRetry = false;
                    console.log('[Spine] Retry OK for node #' + node.id);
                } catch (e2) {
                    // 仍失败，下帧继续
                }
            }
            if (node._needsWebGLRetry) { result = nodesIter.next(); continue; }
        }

        if (!node.gl) { result = nodesIter.next(); continue; }

        var gl = node.gl;
        var skeleton = node.skeleton;
        var state = node.state;

        state.update(dt);
        state.apply(skeleton);
        skeleton.updateWorldTransform(node._physParam);

        // 绘制骨骼标记十字叉（在 Spine 画布上叠加）
        try { SMTool._drawBoneMarks(node, skeleton); } catch (e) {}

        if ((node._spineVer === '4.3' || node._spineVer === '4.2') && node.sceneRenderer && node.sceneRenderer.begin) {
            // 4.x 渲染
            gl.viewport(0, 0, node.canvas.width, node.canvas.height);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            node.sceneRenderer.begin();
            node.sceneRenderer.drawSkeleton(skeleton);
            node.sceneRenderer.end();
        } else if (node.shader && node.batcher && node.skeletonRenderer && WGL38) {
            // 3.8 渲染
            gl.viewport(0, 0, node.canvas.width, node.canvas.height);
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);

            node.shader.bind();
            node.shader.setUniformi(WGL38.Shader.SAMPLER, 0);
            node.shader.setUniform4x4f(WGL38.Shader.MVP_MATRIX, node.mvp.values);

            node.batcher.begin(node.shader);
            node.skeletonRenderer.premultipliedAlpha = node.premultipliedAlpha;
            node.skeletonRenderer.draw(node.batcher, skeleton);
            node.batcher.end();

            node.shader.unbind();
        } else {
            // 兜底：渲染条件不满足时至少清屏为暗色，防止白色残留
            gl.viewport(0, 0, node.canvas.width, node.canvas.height);
            gl.clearColor(0.07, 0.07, 0.09, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        result = nodesIter.next();
    }

    // 绘制网格和连线
    SMTool._renderGrid();
    SMTool._renderConnections();
};

// ---- 缩放 ----
SMTool._onWheel = function (e) {
    var oz = SMData.view.zoom;
    var factor = e.deltaY > 0 ? 0.95 : 1.05;
    SMData.view.zoom = Math.max(0.1, Math.min(5, SMData.view.zoom * factor));
    var mx = e.clientX - window.innerWidth / 2;
    var my = e.clientY - window.innerHeight / 2;
    SMData.view.x += mx * (1 / SMData.view.zoom - 1 / oz);
    SMData.view.y += my * (1 / SMData.view.zoom - 1 / oz);
    SMTool._updateAllPos();
    SMTool._syncZoomUI();
};

SMTool._onZoomSlider = function (e) {
    var pct = parseInt(e.target.value) / 100;
    var oz = SMData.view.zoom;
    SMData.view.zoom = pct;
    var cx = window.innerWidth / 2;
    var cy = window.innerHeight / 2;
    SMData.view.x += cx * (1 / SMData.view.zoom - 1 / oz);
    SMData.view.y += cy * (1 / SMData.view.zoom - 1 / oz);
    SMTool._updateAllPos();
    SMTool._syncZoomUI();
};

SMTool._syncZoomUI = function () {
    var pct = Math.round(SMData.view.zoom * 100);
    document.getElementById('zoomLabel').textContent = pct + '%';
    var slider = document.getElementById('zoomSlider');
    if (Math.abs(parseInt(slider.value) - pct) > 1) slider.value = pct;
};

// ---- 适合视图 / 重置视图 ----
SMTool.fitAll = function () {
    if (!SMData.nodes.size) return;
    var mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        mx = Math.min(mx, n.x);
        my = Math.min(my, n.y);
        Mx = Math.max(Mx, n.x + n.width);
        My = Math.max(My, n.y + 400);
        result = nodesIter.next();
    }
    SMData.view.zoom = Math.min(window.innerWidth / (Mx - mx + 200), window.innerHeight / (My - my + 200), 2);
    SMData.view.x = -(mx + Mx) / 2;
    SMData.view.y = -(my + My) / 2;
    SMTool._updateAllPos();
    SMTool._syncZoomUI();
};

SMTool.resetView = function () {
    SMData.view = { x: 0, y: 0, zoom: 1 };
    SMTool._updateAllPos();
    SMTool._syncZoomUI();
};

// ---- 空格键平移 ----
SMTool._onPanStart = function (e) {
    SMData.isPanning = true;
    SMData.panStart = { x: e.clientX, y: e.clientY };
    SMData.viewStart = { x: SMData.view.x, y: SMData.view.y };
};

SMTool._onPanMove = function (e) {
    if (!SMData.isPanning) return;
    SMData.view.x = SMData.viewStart.x + (e.clientX - SMData.panStart.x) / SMData.view.zoom;
    SMData.view.y = SMData.viewStart.y + (e.clientY - SMData.panStart.y) / SMData.view.zoom;
    SMTool._updateAllPos();
};

SMTool._onPanEnd = function () {
    SMData.isPanning = false;
};

// ---- 调整大小 ----
SMTool.resize = function () {
    SMTool.gridCanvas.width = window.innerWidth;
    SMTool.gridCanvas.height = window.innerHeight;
    SMTool.connCanvas.width = window.innerWidth;
    SMTool.connCanvas.height = window.innerHeight;
};
