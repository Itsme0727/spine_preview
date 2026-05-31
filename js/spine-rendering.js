/* ================================================================
   Spine 渲染 — 共享 WebGL 上下文 + 视口裁剪渲染
   核心优化：所有 Spine 节点共享一个 WebGL 上下文，突破浏览器上下文上限
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 共享 WebGL 状态 ----
SMTool._sharedCanvas = null;
SMTool._sharedGL = null;
SMTool._boneOverlay = null;
SMTool._boneOverlayCtx = null;

// ---- 纹理共享缓存 ----
// 结构：{ "texDataUrl||pageIdx": { texture: GLTexture, refCount: number } }
// 同一 Spine 源文件的多个节点共享 GL 纹理，避免重复创建
SMTool._texCache = {};

// 获取或创建共享纹理
SMTool._getOrCreateTex38 = function (gl, WGL, texDataUrl, pageIdx, img) {
    var key = texDataUrl + '||' + pageIdx;
    var entry = SMTool._texCache[key];
    if (entry) {
        entry.refCount++;
        return entry.texture;
    }
    var glTex = new WGL.GLTexture(gl, img, false);
    SMTool._texCache[key] = { texture: glTex, refCount: 1 };
    return glTex;
};

SMTool._getOrCreateTex4x = function (context, SP, texDataUrl, pageIdx, img, pma) {
    var key = texDataUrl + '||' + pageIdx;
    var entry = SMTool._texCache[key];
    if (entry) {
        entry.refCount++;
        return entry.texture;
    }
    var glTex = new SP.GLTexture(context, img, pma || false);
    SMTool._texCache[key] = { texture: glTex, refCount: 1 };
    return glTex;
};

// 释放节点持有的纹理引用（节点删除时调用）
SMTool._releaseNodeTextures = function (node) {
    if (!node._texCacheKeys) return;
    for (var i = 0; i < node._texCacheKeys.length; i++) {
        var key = node._texCacheKeys[i];
        var entry = SMTool._texCache[key];
        if (entry) {
            entry.refCount--;
            if (entry.refCount <= 0) {
                try { entry.texture.dispose(); } catch (e) {}
                delete SMTool._texCache[key];
            }
        }
    }
    node._texCacheKeys = [];
};

// ---- 初始化共享 WebGL 渲染器（只创建一次，所有节点共用）----
SMTool._initSharedRenderer = function () {
    if (SMTool._sharedCanvas) return;  // 已初始化

    var canvas = document.createElement('canvas');
    canvas.id = 'sharedSpineCanvas';
    canvas.style.cssText = 'position:absolute;top:0;left:0;z-index:3;pointer-events:none';
    document.getElementById('app').appendChild(canvas);

    SMTool._resizeSharedRenderer();

    var gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: false }) ||
              canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: false });

    if (!gl) {
        console.error('[SharedRenderer] WebGL not available');
        return;
    }

    SMTool._sharedCanvas = canvas;
    SMTool._sharedGL = gl;

    // 混合模式
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // 骨骼标记叠加层（2D Canvas，在 Spine 画布上方）
    var overlay = document.createElement('canvas');
    overlay.id = 'boneOverlay';
    overlay.style.cssText = 'position:absolute;top:0;left:0;z-index:4;pointer-events:none';
    document.getElementById('app').appendChild(overlay);

    SMTool._boneOverlay = overlay;
    SMTool._boneOverlayCtx = overlay.getContext('2d');
    SMTool._resizeSharedRenderer();

    console.log('[SharedRenderer] Initialized — all nodes will share 1 WebGL context');
};

// ---- 调整共享渲染器尺寸 ----
SMTool._resizeSharedRenderer = function () {
    var c = SMTool._sharedCanvas;
    if (c) {
        c.width = window.innerWidth;
        c.height = window.innerHeight;
    }
    var o = SMTool._boneOverlay;
    if (o) {
        o.width = window.innerWidth;
        o.height = window.innerHeight;
    }
};

// ---- 共享模式骨骼标记绘制（在 2D 叠加层上）----
SMTool._drawBoneMarksShared = function (node, skeleton, screenX, screenY, screenW, screenH) {
    try {
        var marks = SMData._boneMarkStore;
        if (!marks) return;

        var key = node.sourceFile + '||' + (node.currentAnim || '');
        var boneSet = marks[key];
        if (!boneSet) return;

        var boneNames = Object.keys(boneSet);
        if (!boneNames.length) return;

        var ctx = SMTool._boneOverlayCtx;
        if (!ctx) return;

        var cw = node._canvasWidth;
        var ch = node._canvasHeight;
        var sz = SMData.view.zoom;
        var is4x = node._spineVer === '4.3' || node._spineVer === '4.2';

        for (var i = 0; i < boneNames.length; i++) {
            var bone = skeleton.findBone(boneNames[i]);
            if (!bone) continue;
            if (typeof bone.getWorldX !== 'function' || typeof bone.getWorldY !== 'function') continue;

            var wx = bone.getWorldX();
            var wy = bone.getWorldY();
            if (isNaN(wx) || isNaN(wy)) continue;

            // 骨骼世界坐标 → 骨架本地像素 → 屏幕像素
            var sx = skeleton.x + wx;
            var sy = is4x ? (skeleton.y + wy) : (ch - (skeleton.y + wy));

            // 映射到屏幕
            var bx = screenX + sx * sz;
            var by = screenY + sy * sz;

            if (bx < screenX || bx > screenX + screenW || by < screenY || by > screenY + screenH) continue;

            // 绘制红色十字叉
            var size = Math.max(4, 6 * sz);
            ctx.save();
            ctx.strokeStyle = '#ff3333';
            ctx.lineWidth = Math.max(1, 1.5 * sz);
            ctx.shadowColor = 'rgba(255,0,0,0.6)';
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.moveTo(bx - size, by);
            ctx.lineTo(bx + size, by);
            ctx.moveTo(bx, by - size);
            ctx.lineTo(bx, by + size);
            ctx.stroke();

            ctx.fillStyle = '#ff3333';
            ctx.shadowBlur = 0;
            ctx.beginPath();
            ctx.arc(bx, by, Math.max(1.5, 2 * sz), 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    } catch (e) {
        // 骨骼标记绘制失败不影响渲染
    }
};

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

// ---- WebGL 渲染器设置（使用共享 GL 上下文）----
SMTool._setupWebGLRenderer = function (node, SP, WGL, atlas, img, useVer) {
    var sk = node.skeleton;
    var physParam = node._physParam;
    var sharedGL = SMTool._sharedGL;

    if (!sharedGL) {
        console.warn('[Spine] Shared GL not ready, retry later for #' + node.id);
        node._needsWebGLRetry = true;
        return;
    }

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
    console.log('[Spine] SharedGL: ' + cw + 'x' + ch + ' for #' + node.id + ', bounds: ' + boundsSize.x.toFixed(0) + 'x' + boundsSize.y.toFixed(0));

    // 更新 DOM 占位区域（用尺寸 div 撑开面板，骨架由共享画布渲染）
    var nodeEl = SMTool._getEl(node.id);
    if (nodeEl) {
        var wrap = nodeEl.querySelector('.spine-canvas-wrap');
        if (wrap) {
            var oldContainer = wrap.querySelector('.spine-canvas-container');
            if (oldContainer) oldContainer.remove();
            var oldC = wrap.querySelector('canvas');
            if (oldC) oldC.remove();

            // 找到原始占位 div，调整为骨架画布尺寸
            var ph = wrap.querySelector('div');
            if (ph) {
                ph.style.width = cw + 'px';
                ph.style.height = ch + 'px';
                ph.style.padding = '0';
                ph.style.display = 'block';
            }
            wrap.style.width = cw + 'px';
            wrap.style.height = ch + 'px';
        }
    }

    node._canvasWidth = cw;
    node._canvasHeight = ch;
    node.width = Math.max(cw + 10, node.width, 260);
    if (nodeEl) nodeEl.style.minWidth = node.width + 'px';

    // 居中 Skeleton
    sk.x = cw / 2 - (boundsOff.x + boundsSize.x / 2);
    sk.y = ch / 2 - (boundsOff.y + boundsSize.y / 2);
    sk.updateWorldTransform(physParam);

    // 所有节点共享同一个 gl 引用
    node.gl = sharedGL;
    node.canvas = SMTool._sharedCanvas;
    node._glLost = false;

    // 根据版本设置 WebGL 资源（使用共享上下文）
    try {
        if (useVer === '4.3' || useVer === '4.2') {
            SMTool._setupWebGL4xShared(node, SP, atlas, img, cw, ch);
        } else {
            if (!WGL || !WGL.Shader) {
                console.warn('[Spine] WGL not ready for 3.8 node #' + node.id + ', will retry...');
                node._needsWebGLRetry = true;
                return;
            }
            SMTool._setupWebGL38Shared(node, WGL, atlas, img, cw, ch);
        }
    } catch (e) {
        console.error('[Spine] Shared WebGL setup failed for #' + node.id + ':', e.message);
        if (!node._needsWebGLRetry) {
            node.gl = null;
        }
    }
};

// ---- 4.x WebGL 设置（共享上下文+纹理缓存）----
SMTool._setupWebGL4xShared = function (node, SP, atlas, img, cw, ch) {
    var canvas = SMTool._sharedCanvas;

    var context = new SP.ManagedWebGLRenderingContext(canvas, { alpha: false });
    node._managedContext = context;

    var renderer = new SP.SceneRenderer(canvas, context, true);
    node.sceneRenderer = renderer;

    renderer.camera.position.set(cw / 2, ch / 2, 0);
    renderer.camera.viewportWidth = cw;
    renderer.camera.viewportHeight = ch;
    renderer.camera.update();

    node._texCacheKeys = [];
    var texDataUrl = node._srcTexDataUrl || '';
    for (var i = 0; i < atlas.pages.length; i++) {
        var page = atlas.pages[i];
        var glTex = SMTool._getOrCreateTex4x(context, SP, texDataUrl, i, img, page.pma || false);
        page.setTexture(glTex);
        node.glTextures.push(glTex);
        node._texCacheKeys.push(texDataUrl + '||' + i);
    }
    for (var j = 0; j < atlas.regions.length; j++) {
        atlas.regions[j].texture = atlas.regions[j].page.texture;
    }
};

// ---- 3.8 WebGL 设置（共享上下文+纹理缓存+Shader共享）----
SMTool._setupWebGL38Shared = function (node, WGL, atlas, img, cw, ch) {
    var gl = SMTool._sharedGL;

    node.shader = WGL.Shader.newTwoColoredTextured(gl);
    node.batcher = new WGL.PolygonBatcher(gl);
    node.mvp = new WGL.Matrix4();
    node.skeletonRenderer = new WGL.SkeletonRenderer(gl);
    node.mvp.ortho2d(0, 0, cw - 1, ch - 1);

    node._texCacheKeys = [];
    var texDataUrl = node._srcTexDataUrl || '';
    for (var i = 0; i < atlas.pages.length; i++) {
        var page = atlas.pages[i];
        try {
            var glTex = SMTool._getOrCreateTex38(gl, WGL, texDataUrl, i, img);
            page.texture = glTex;
            node.glTextures.push(glTex);
            node._texCacheKeys.push(texDataUrl + '||' + i);
        } catch (e) {
            console.warn('[Spine] GL texture failed:', e);
        }
    }
    for (var j = 0; j < atlas.regions.length; j++) {
        var region = atlas.regions[j];
        if (region.page && region.page.texture) region.texture = region.page.texture;
    }
};

// ---- 渲染循环（共享 WebGL 上下文 + 视口裁剪）----
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

    var gl = SMTool._sharedGL;
    if (!gl) return;

    var WGL38 = window.spine38 && window.spine38.webgl;
    var sharedCanvas = SMTool._sharedCanvas;
    var cwFull = sharedCanvas.width;
    var chFull = sharedCanvas.height;

    // 不清空全屏！共享画布在节点上方，全屏清除会遮盖所有 UI 面板
    // 改为只在每个节点的 canvas-wrap 区域做 scissor 清除+绘制
    // 画布未绘制区域保持透明，让下层节点面板和网格透出

    // 清空骨骼标记叠加层
    var bctx = SMTool._boneOverlayCtx;
    var bo = SMTool._boneOverlay;
    if (bctx && bo) {
        bctx.clearRect(0, 0, bo.width, bo.height);
    }

    // ---- 视口裁剪：计算当前可见的世界坐标范围 ----
    var z = SMData.view.zoom;
    var vx = SMData.view.x;
    var vy = SMData.view.y;
    // 紧凑缓冲区：仅扩展半屏，边缘节点冻结动画
    var vpW = cwFull / z;
    var vpH = chFull / z;
    // 可见区（渲染 + 动画更新）
    var visLeft   = -vx - vpW / 2;
    var visTop    = -vy - vpH / 2;
    var visRight  = visLeft + vpW;
    var visBottom = visTop + vpH;
    // 冻结区（渲染但不更新动画）：可见区外扩 50 世界单位
    var margin = 50;
    var frzLeft   = visLeft - margin;
    var frzTop    = visTop - margin;
    var frzRight  = visRight + margin;
    var frzBottom = visBottom + margin;

    gl.enable(gl.SCISSOR_TEST);

    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var node = result.value;

        if (!node.state || !node.skeleton || !node._canvasWidth) { result = nodesIter.next(); continue; }

        if (node._needsWebGLRetry) {
            var WGLnow = window.spine38 && window.spine38.webgl;
            if (WGLnow && WGLnow.Shader && node.atlasData && node.textureImg) {
                try {
                    SMTool._setupWebGL38Shared(node, WGLnow, node.atlasData, node.textureImg, node._canvasWidth, node._canvasHeight);
                    node._needsWebGLRetry = false;
                } catch (e2) {}
            }
            if (node._needsWebGLRetry) { result = nodesIter.next(); continue; }
        }

        if (!node.gl) { result = nodesIter.next(); continue; }

        var nodeW = node._canvasWidth, nodeH = node._canvasHeight;

        if (node.x + nodeW < frzLeft || node.x > frzRight ||
            node.y + nodeH < frzTop || node.y > frzBottom) {
            node._visible = false; result = nodesIter.next(); continue;
        }
        node._visible = true;

        var sp = SMTool.worldToCanvas(node.x, node.y);
        var sx = Math.round(sp.x), sy = Math.round(sp.y);
        var sw = Math.round(nodeW * z), sh = Math.round(nodeH * z);

        if (sw < 4 || sh < 4) { result = nodesIter.next(); continue; }

        // 缩放 >= 20%：正常动画；< 20%：冻结动画（静态图跟随面板）
        if (z >= 0.20) {
            node.state.update(dt);
            node.state.apply(node.skeleton);
        }
        node.skeleton.updateWorldTransform(node._physParam);

        var glY = chFull - sy - sh;
        gl.scissor(sx, glY, sw, sh);
        gl.viewport(sx, glY, sw, sh);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        if ((node._spineVer === '4.3' || node._spineVer === '4.2') && node.sceneRenderer && node.sceneRenderer.begin) {
            node.sceneRenderer.camera.position.set(nodeW / 2, nodeH / 2, 0);
            node.sceneRenderer.camera.viewportWidth = nodeW;
            node.sceneRenderer.camera.viewportHeight = nodeH;
            node.sceneRenderer.camera.update();
            node.sceneRenderer.begin();
            node.sceneRenderer.drawSkeleton(node.skeleton);
            node.sceneRenderer.end();
        } else if (node.shader && node.batcher && node.skeletonRenderer && WGL38) {
            node.mvp.ortho2d(0, 0, nodeW - 1, nodeH - 1);
            node.shader.bind();
            node.shader.setUniformi(WGL38.Shader.SAMPLER, 0);
            node.shader.setUniform4x4f(WGL38.Shader.MVP_MATRIX, node.mvp.values);
            node.batcher.begin(node.shader);
            node.skeletonRenderer.premultipliedAlpha = node.premultipliedAlpha;
            node.skeletonRenderer.draw(node.batcher, node.skeleton);
            node.batcher.end();
            node.shader.unbind();
        }

        SMTool._drawBoneMarksShared(node, node.skeleton, sx, sy, sw, sh);
        result = nodesIter.next();
    }

    gl.disable(gl.SCISSOR_TEST);

    // 绘制网格和连线（2D Canvas，不受 WebGL 影响）
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
    SMTool._resizeSharedRenderer();
};
