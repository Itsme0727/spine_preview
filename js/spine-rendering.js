/* ================================================================
   Spine 渲染 — 共享 WebGL 上下文 + 视口裁剪渲染
   核心优化：所有 Spine 节点共享一个 WebGL 上下文，突破浏览器上下文上限
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 共享 WebGL 状态 ----
SMTool._sharedCanvas = null;
SMTool._sharedGL = null;

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

    // stencil: true 是必须的 — Spine 的裁剪(Clipping)和遮罩(Mask)功能依赖模板缓冲区
    var gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true }) ||
              canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true });

    if (!gl) {
        console.error('[SharedRenderer] WebGL not available');
        return;
    }

    SMTool._sharedCanvas = canvas;
    SMTool._sharedGL = gl;

    // 混合模式 — 不预设全局 blend，由各 Spine 运行时内部按 slot 控制
    gl.enable(gl.BLEND);
    // 默认 blend 函数仅作为后备，实际渲染由 Spine batcher/shader 逐 slot 覆盖
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    console.log('[SharedRenderer] Initialized — all nodes will share 1 WebGL context');
};

// ---- 调整共享渲染器尺寸 ----
SMTool._resizeSharedRenderer = function () {
    var c = SMTool._sharedCanvas;
    if (c) {
        c.width = window.innerWidth;
        c.height = window.innerHeight;
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
// imgs: 按 atlas page 索引的 Image 数组
SMTool._setupWebGLRenderer = function (node, SP, WGL, atlas, imgs, useVer) {
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
                ph.textContent = '';  // 隐藏"拖入 Spine 文件"
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
            SMTool._setupWebGL4xShared(node, SP, atlas, imgs, cw, ch);
        } else {
            if (!WGL || !WGL.Shader) {
                console.warn('[Spine] WGL not ready for 3.8 node #' + node.id + ', will retry...');
                node._needsWebGLRetry = true;
                return;
            }
            SMTool._setupWebGL38Shared(node, WGL, atlas, imgs, cw, ch);
        }
    } catch (e) {
        console.error('[Spine] Shared WebGL setup failed for #' + node.id + ':', e.message);
        if (!node._needsWebGLRetry) {
            node.gl = null;
        }
    }
};

// ---- 4.x 共享 ManagedWebGLRenderingContext（所有 4.x 节点共用一个，避免状态追踪错乱）----
SMTool._sharedManagedContext4x = null;

// ---- 4.x WebGL 设置（共享上下文+纹理缓存+多图集）----
SMTool._setupWebGL4xShared = function (node, SP, atlas, imgs, cw, ch) {
    var canvas = SMTool._sharedCanvas;

    // 所有 4.x 节点共用一个 ManagedWebGLRenderingContext 实例
    // 多个实例包裹同一个 canvas 会导致内部 GL 状态追踪错乱，
    // 进而导致贴图混合模式（Additive等）失效、裁剪区域黑屏等问题
    if (!SMTool._sharedManagedContext4x) {
        SMTool._sharedManagedContext4x = new SP.ManagedWebGLRenderingContext(canvas, { alpha: true });
        console.log('[SharedRenderer] Created single shared ManagedWebGLRenderingContext for all 4.x nodes');
    }
    var context = SMTool._sharedManagedContext4x;
    node._managedContext = context;

    var renderer = new SP.SceneRenderer(canvas, context, true);
    node.sceneRenderer = renderer;

    renderer.camera.position.set(cw / 2, ch / 2, 0);
    renderer.camera.viewportWidth = cw;
    renderer.camera.viewportHeight = ch;
    renderer.camera.update();

    node._texCacheKeys = [];
    var pageDataUrls = node._srcTexDataUrls || [];
    for (var i = 0; i < atlas.pages.length; i++) {
        var page = atlas.pages[i];
        var pageImg = (imgs && i < imgs.length) ? imgs[i] : (imgs && imgs[0]) || null;
        var texDataUrl = (pageDataUrls && i < pageDataUrls.length)
            ? pageDataUrls[i].dataUrl
            : (node._srcTexDataUrl || '');
        var glTex = SMTool._getOrCreateTex4x(context, SP, texDataUrl, i, pageImg, page.pma || false);
        page.setTexture(glTex);
        node.glTextures.push(glTex);
        node._texCacheKeys.push(texDataUrl + '||' + i);
    }
    for (var j = 0; j < atlas.regions.length; j++) {
        atlas.regions[j].texture = atlas.regions[j].page.texture;
    }
};

// ---- 3.8 WebGL 设置（共享上下文+纹理缓存+Shader共享+多图集）----
SMTool._setupWebGL38Shared = function (node, WGL, atlas, imgs, cw, ch) {
    var gl = SMTool._sharedGL;

    node.shader = WGL.Shader.newTwoColoredTextured(gl);
    node.batcher = new WGL.PolygonBatcher(gl);
    node.mvp = new WGL.Matrix4();
    node.skeletonRenderer = new WGL.SkeletonRenderer(gl);
    node.mvp.ortho2d(0, 0, cw - 1, ch - 1);

    node._texCacheKeys = [];
    var pageDataUrls = node._srcTexDataUrls || [];
    for (var i = 0; i < atlas.pages.length; i++) {
        var page = atlas.pages[i];
        var pageImg = (imgs && i < imgs.length) ? imgs[i] : (imgs && imgs[0]) || null;
        var texDataUrl = (pageDataUrls && i < pageDataUrls.length)
            ? pageDataUrls[i].dataUrl
            : (node._srcTexDataUrl || '');
        try {
            var glTex = SMTool._getOrCreateTex38(gl, WGL, texDataUrl, i, pageImg);
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
        // 内存（Chrome only，含 JS 堆 + DOM 等）
        if (performance.memory) {
            var mb = (performance.memory.totalJSHeapSize / 1048576).toFixed(1);
            document.getElementById('sbMemory').textContent = '内存: ' + mb + 'MB';
        }
        // 统计全局 Draw 和骨骼数
        var totalDraws = 0, totalBones = 0;
        var nodesIter2 = SMData.nodes.values();
        var r2 = nodesIter2.next();
        while (!r2.done) {
            var nd = r2.value;
            if (nd.skeleton) {
                totalBones += nd.bones.length;
                totalDraws += (nd.skeleton.drawOrder ? nd.skeleton.drawOrder.length : 0);
            }
            r2 = nodesIter2.next();
        }
        document.getElementById('sbBones').textContent = '骨骼: ' + totalBones;
        document.getElementById('sbDraws').textContent = 'Draw call: ' + totalDraws;
        SMTool._fc = 0;
        SMTool._ft = now;
    }

    var gl = SMTool._sharedGL;
    if (!gl) return;

    var WGL38 = window.spine38 && window.spine38.webgl;
    var sharedCanvas = SMTool._sharedCanvas;
    var cwFull = sharedCanvas.width;
    var chFull = sharedCanvas.height;

    // 每帧全清画布为透明，同时清除模板缓冲区，确保非渲染区域不会残留旧像素
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, cwFull, chFull);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

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
            if (WGLnow && WGLnow.Shader && node.atlasData && (node.textureImg || (node._texImgs && node._texImgs.length > 0))) {
                try {
                    var retryImgs = (node._texImgs && node._texImgs.length > 0) ? node._texImgs : [node.textureImg];
                    SMTool._setupWebGL38Shared(node, WGLnow, node.atlasData, retryImgs, node._canvasWidth, node._canvasHeight);
                    node._needsWebGLRetry = false;
                } catch (e2) {}
            }
            if (node._needsWebGLRetry) { result = nodesIter.next(); continue; }
        }

        if (!node.gl) { result = nodesIter.next(); continue; }

        var nodeW = node._canvasWidth, nodeH = node._canvasHeight;
        var nodeScale = (node._customScale !== undefined ? node._customScale : 1.0);
        var scaledW = nodeW * nodeScale;
        var scaledH = nodeH * nodeScale;

        if (node.x + scaledW < frzLeft || node.x > frzRight ||
            node.y + scaledH < frzTop || node.y > frzBottom) {
            node._visible = false; result = nodesIter.next(); continue;
        }
        node._visible = true;

        var sp = SMTool.worldToCanvas(node.x, node.y);
        var sx = Math.round(sp.x), sy = Math.round(sp.y);
        var nodeScale = (node._customScale !== undefined ? node._customScale : 1.0);
        var sw = Math.round(nodeW * z * nodeScale), sh = Math.round(nodeH * z * nodeScale);

        // 跳过 header 区域，scissor 从 canvas-wrap 位置开始
        if (!node._headerH || node._headerH <= 0) {
            var el = SMTool._getEl(node.id);
            var hdr = el ? el.querySelector('.header') : null;
            var measured = hdr ? hdr.offsetHeight : 0;
            node._headerH = measured > 0 ? measured : 70;
        }
        var headerOffset = Math.round(node._headerH * z * nodeScale);
        sy += headerOffset;

        if (sw < 4 || sh < 4) { result = nodesIter.next(); continue; }

        // 动画更新：动态模式始终 60fps，性能模式 <20% 冻结（但播放中的动画组节点不受限）
        var isFlowPlaying = SMData._fullPlayback && SMData._fullPlayback.isPlaying;
        var isPlayingNode = isFlowPlaying && SMData._fullPlayback.activePathIdx >= 0 &&
            SMData._fullPaths[SMData._fullPlayback.activePathIdx] &&
            SMData._fullPaths[SMData._fullPlayback.activePathIdx].nodes[SMData._fullPlayback.currentStep] &&
            SMData._fullPaths[SMData._fullPlayback.activePathIdx].nodes[SMData._fullPlayback.currentStep].id === node.id;
        if (SMData.renderMode === 'dyn' || z >= 0.20 || isPlayingNode) {
            node.state.update(dt);
            node.state.apply(node.skeleton);
        }
        node.skeleton.updateWorldTransform(node._physParam);

        var glY = chFull - sy - sh;
        gl.scissor(sx, glY, sw, sh);
        gl.viewport(sx, glY, sw, sh);
        gl.clearColor(0, 0, 0, 0);
        gl.clearStencil(0);
        // 同时清除颜色和模板缓冲区 — stencil 对裁剪/Mask 至关重要
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
        // 重置混合模式为默认值，防止上一节点的 slot 混合模式污染当前节点
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        // 【关键】同步 batcher 的内部混合状态缓存。
        // PolygonBatcher 内部缓存 srcBlend/dstBlend，若与目标值一致则跳过 gl.blendFunc()。
        // 我们的外部 gl.blendFunc() 重置不被 batcher 感知 → batcher 可能错误跳过设置。
        // 将 batcher 内部缓存同步到当前 GL 实际值，确保首次 draw 时状态一致。
        if (node.batcher) {
            node.batcher.srcBlend = gl.ONE;
            node.batcher.dstBlend = gl.ONE_MINUS_SRC_ALPHA;
        }
        // 同样同步 4.x ManagedWebGLRenderingContext 的混合状态缓存（若存在）
        var mc = SMTool._sharedManagedContext4x;
        if (mc) {
            try {
                // 尝试通过 managedContext 的 blendFunc API 同步（同时更新缓存和 GL）
                if (typeof mc.blendFunc === 'function') {
                    mc.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                }
            } catch (e) {
                // 回退：直接修改内部缓存属性（不同版本属性名可能不同）
                try { if (mc._blendSrc !== undefined) { mc._blendSrc = gl.ONE; mc._blendDst = gl.ONE_MINUS_SRC_ALPHA; } } catch (e2) {}
                try { if (mc._cachedBlendSrc !== undefined) { mc._cachedBlendSrc = gl.ONE; mc._cachedBlendDst = gl.ONE_MINUS_SRC_ALPHA; } } catch (e2) {}
            }
        }

        if ((node._spineVer === '4.3' || node._spineVer === '4.2') && node.sceneRenderer && node.sceneRenderer.begin) {
            node.sceneRenderer.camera.position.set(nodeW / 2, nodeH / 2, 0);
            node.sceneRenderer.camera.viewportWidth = nodeW;
            node.sceneRenderer.camera.viewportHeight = nodeH;
            node.sceneRenderer.camera.update();
            node.sceneRenderer.begin();
            // SceneRenderer.begin() 可能重置 viewport/scissor，重新应用节点专属裁剪区域
            gl.viewport(sx, glY, sw, sh);
            gl.scissor(sx, glY, sw, sh);
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

        result = nodesIter.next();
    }

    gl.disable(gl.SCISSOR_TEST);

    // 绘制网格和连线（2D Canvas，不受 WebGL 影响）
    SMTool._renderGrid();
    SMTool._renderGroupBoxes(SMTool.gridCtx);
    SMTool._renderConnections();

    // 鸟瞰图（小地图）
    SMTool._renderMinimap();

    // ★ 右上角动画预览浮窗渲染
    SMTool._renderAnimPreview(now);
};

// ---- 缩放 ----
SMTool._onWheel = function (e) {
    var oz = SMData.view.zoom;
    var factor = e.deltaY > 0 ? 0.95 : 1.05;
    SMData.view.zoom = Math.max(0.03, Math.min(5, SMData.view.zoom * factor));
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

// ================================================================
// ★ 右上角动画预览浮窗面板 — 独立 WebGL 渲染
// ================================================================

// ---- 初始化预览骨架 ----
// 从源节点复用源数据，创建独立的 WebGL canvas + 上下文 + Spine 骨架
SMTool._initAnimPreview = function (node) {
    var pp = SMData._animPreview;
    if (!node || !node._srcAtlasText || !(node._srcSkelJson || node._srcSkelBinBase64)) return;

    // 先销毁旧预览
    SMTool._destroyAnimPreview();

    var panel = document.getElementById('animPreviewPanel');
    var canvas = document.getElementById('appCanvas');
    if (!panel || !canvas) return;

    // 查找匹配的动画名
    // 优先从 node.animations 查找，回退到 skeletonData.animations
    var allAnims = (node.animations && node.animations.length > 0)
        ? node.animations
        : (node.skeletonData && node.skeletonData.animations
            ? node.skeletonData.animations.map(function(a) { return { name: a.name, duration: a.duration || 0 }; })
            : []);
    var targetAnim = node.currentAnim;
    if (!targetAnim || targetAnim.length === 0) {
        if (allAnims.length > 0) {
            targetAnim = allAnims[0].name;
        } else {
            return; // 无可用动画，跳过
        }
    }

    // 验证动画名在动画列表中
    var animFound = false;
    for (var ai = 0; ai < allAnims.length; ai++) {
        if (allAnims[ai].name === targetAnim) { animFound = true; break; }
    }
    if (!animFound) return; // 动画名不匹配，跳过

    var ver = node.version || node._spineVer || '';
    var useVer = SMTool._resolveRuntimeVersion(ver, null, false);
    var SP = SMTool._getSpineRuntime(useVer);
    var WGL = useVer === '3.8' ? (window.spine38 && window.spine38.webgl) : null;

    if (!SP) return;

    pp._spineVer = useVer;
    var physParam = (useVer !== '3.8' && SP.Physics) ? SP.Physics.update : undefined;

    // 设置面板尺寸和画布
    canvas.width = 280;
    canvas.height = 420;
    pp.canvas = canvas;
    pp.panelW = 280;
    pp.panelH = 420;

    // 获取画布 WebGL 上下文
    var gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true }) ||
              canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true });

    if (!gl) {
        console.warn('[AnimPreview] WebGL not available for preview canvas');
        return;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    pp.gl = gl;

    // 解析 atlas
    var atlasText = node._srcAtlasText;
    var pageDataUrls = (node._srcTexDataUrls && node._srcTexDataUrls.length > 0)
        ? node._srcTexDataUrls
        : [{ name: 'texture', dataUrl: node._srcTexDataUrl }];

    // 加载图片（同步使用已缓存的 Image，因为源节点已加载过）
    var imgs = [];
    var needLoad = false;
    for (var pi = 0; pi < pageDataUrls.length; pi++) {
        var existingImg = null;
        // 尝试从共享缓存中查找已加载的图片
        var nodesIter2 = SMData.nodes.values();
        var r2 = nodesIter2.next();
        while (!r2.done) {
            var nd = r2.value;
            if (nd._texImgs && nd._texImgs[pi]) {
                existingImg = nd._texImgs[pi];
                break;
            }
            if (nd.textureImg && pi === 0) {
                existingImg = nd.textureImg;
                break;
            }
            r2 = nodesIter2.next();
        }
        if (existingImg) {
            imgs[pi] = existingImg;
        } else {
            needLoad = true;
            var img = new Image();
            img.src = pageDataUrls[pi].dataUrl;
            imgs[pi] = img;
        }
    }

    function doSetup() {
        try {
            var atlas;
            if (useVer === '4.3' || useVer === '4.2') {
                atlas = new SP.TextureAtlas(atlasText);
            } else {
                var firstImg2 = imgs[0];
                atlas = new SP.TextureAtlas(atlasText, function (pagePath) {
                    var pathStr = (typeof pagePath === 'string') ? pagePath : (pagePath && pagePath.name ? pagePath.name : '');
                    var pageFileName = pathStr.replace(/\\/g, '/').split('/').pop().toLowerCase();
                    var matchImg = firstImg2;
                    if (pageDataUrls && imgs) {
                        for (var pdi = 0; pdi < pageDataUrls.length; pdi++) {
                            if (pageDataUrls[pdi].name.toLowerCase() === pageFileName && imgs[pdi]) {
                                matchImg = imgs[pdi];
                                break;
                            }
                        }
                    }
                    return new SP.FakeTexture(matchImg);
                });
            }
            pp._atlasData = atlas;
            pp._texImgs = imgs;

            var al = new SP.AtlasAttachmentLoader(atlas);
            var sd;
            var srcType = node._srcType || 'json';
            if (srcType === 'skel' && node._srcSkelBinBase64) {
                var skelBin = SMTool._base64ToUint8(node._srcSkelBinBase64);
                var bl = new SP.SkeletonBinary(al); bl.scale = 1;
                sd = bl.readSkeletonData(skelBin);
            } else {
                if (!node._srcSkelJson) return;
                var jl = new SP.SkeletonJson(al); jl.scale = 1;
                sd = jl.readSkeletonData(node._srcSkelJson);
            }
            pp._skeletonData = sd;

            var sk = new SP.Skeleton(sd);
            if (sd.defaultSkin) sk.setSkin(sd.defaultSkin);
            sk.setToSetupPose();
            sk.updateWorldTransform(physParam);
            pp.skeleton = sk;
            pp._physParam = physParam;

            // 计算边界和画布适配
            var boundsOff = new SP.Vector2();
            var boundsSize = new SP.Vector2();
            try {
                if (typeof sk.getBounds === 'function') {
                    sk.getBounds(boundsOff, boundsSize, []);
                } else {
                    SMTool._computeBoundsManually(sk, boundsOff, boundsSize);
                }
            } catch (e) {
                SMTool._computeBoundsManually(sk, boundsOff, boundsSize);
            }

            var cw = canvas.width, ch = canvas.height;
            pp._canvasWidth = cw;
            pp._canvasHeight = ch;
            // ★ 保存参考尺寸和边界信息供 resize 缩放/居中
            pp._refCw = cw;
            pp._refCh = ch;
            pp._boundsOffset = { x: boundsOff.x, y: boundsOff.y };
            pp._boundsSize = { x: boundsSize.x, y: boundsSize.y };
            sk.x = cw / 2 - (boundsOff.x + boundsSize.x / 2);
            sk.y = ch / 2 - (boundsOff.y + boundsSize.y / 2);

            // 设置 WebGL 资源
            pp._texCacheKeys = [];
            if (useVer === '4.3' || useVer === '4.2') {
                var context = new SP.ManagedWebGLRenderingContext(canvas, { alpha: true });
                var renderer = new SP.SceneRenderer(canvas, context, true);
                pp._sceneRenderer = renderer;
                pp._batcher = null;
                pp._shader = null;

                renderer.camera.position.set(cw / 2, ch / 2, 0);
                renderer.camera.viewportWidth = cw;
                renderer.camera.viewportHeight = ch;
                renderer.camera.update();

                for (var i = 0; i < atlas.pages.length; i++) {
                    var page = atlas.pages[i];
                    var pageImg = (imgs && i < imgs.length) ? imgs[i] : (imgs && imgs[0]) || null;
                    // ★ 预览独立 GL 上下文，不能共享主画布的纹理缓存，直接创建
                    var glTex = new SP.GLTexture(context, pageImg, page.pma || false);
                    page.setTexture(glTex);
                    pp._glTextures.push(glTex);
                }
            } else {
                if (!WGL || !WGL.Shader) return;
                pp._shader = WGL.Shader.newTwoColoredTextured(gl);
                pp._batcher = new WGL.PolygonBatcher(gl);
                pp._mvp = new WGL.Matrix4();
                pp._skeletonRenderer = new WGL.SkeletonRenderer(gl);
                pp._mvp.ortho2d(0, 0, cw - 1, ch - 1);

                for (var j = 0; j < atlas.pages.length; j++) {
                    var page2 = atlas.pages[j];
                    var pageImg2 = (imgs && j < imgs.length) ? imgs[j] : (imgs && imgs[0]) || null;
                    try {
                        // ★ 预览独立 GL 上下文，不能共享主画布的纹理缓存，直接创建
                        var glTex2 = new WGL.GLTexture(gl, pageImg2, false);
                        page2.texture = glTex2;
                        pp._glTextures.push(glTex2);
                    } catch (e2) {
                        console.warn('[AnimPreview] GL texture failed:', e2);
                    }
                }
            }
            // ★ 检测并保存预乘 Alpha 标志
            var pma = false;
            if (atlas.pages && atlas.pages.length > 0 && atlas.pages[0].pma) pma = true;
            pp._premultipliedAlpha = pma;

            // 同步 atlas regions 纹理引用
            for (var k = 0; k < atlas.regions.length; k++) {
                var region = atlas.regions[k];
                if (region.page && region.page.texture) region.texture = region.page.texture;
            }

            // ★ 创建 AnimationState 并复制源节点的完整轨道混合配置
            var stateData = new SP.AnimationStateData(sd);
            var state = new SP.AnimationState(stateData);
            pp.state = state;

            // 复制源节点的全部轨道配置（不只是 track 0）
            SMTool._applyPreviewTracks(pp, state, stateData, sd, node);

            state.update(0);
            state.apply(sk);
            sk.updateWorldTransform(physParam);

            pp.nodeId = node.id;
            pp._lastTime = performance.now();

            // 更新面板标题
            var title = document.getElementById('appTitle');
            if (title) title.textContent = '🎬 ' + targetAnim;

        } catch (e) {
            console.error('[AnimPreview] Setup failed:', e);
            SMTool._destroyAnimPreview();
        }
    }

    if (needLoad) {
        // 等待图片加载
        var loadedCount = 0;
        for (var pi2 = 0; pi2 < imgs.length; pi2++) {
            if (imgs[pi2].complete) {
                loadedCount++;
            } else {
                imgs[pi2].onload = function () {
                    loadedCount++;
                    if (loadedCount >= imgs.length) doSetup();
                };
                imgs[pi2].onerror = function () {
                    loadedCount++; // 仍然计数，避免卡住
                    if (loadedCount >= imgs.length) doSetup();
                };
            }
        }
        if (loadedCount >= imgs.length) doSetup();
    } else {
        doSetup();
    }
};

// ---- 渲染预览帧 ----
SMTool._renderAnimPreview = function (now) {
    var pp = SMData._animPreview;
    if (!pp || !pp.visible || !pp.state || !pp.skeleton || !pp.gl) return;

    var canvas = pp.canvas;
    var gl = pp.gl;
    var cw = pp._canvasWidth || canvas.width;
    var ch = pp._canvasHeight || canvas.height;
    var useVer = pp._spineVer;

    var dt = Math.min((now - (pp._lastTime || now)) / 1000, 0.1);
    pp._lastTime = now;

    // 更新动画（flow 播放暂停/结束时冻结预览）
    if (!pp._flowFrozen) {
        pp.state.update(dt);
    }
    pp.state.apply(pp.skeleton);
    pp.skeleton.updateWorldTransform(pp._physParam);

    // 渲染
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    if (useVer === '4.3' || useVer === '4.2') {
        if (pp._sceneRenderer) {
            try {
                pp._sceneRenderer.draw(pp.skeleton);
            } catch (e) { /* ignore */ }
        }
    } else {
        // 3.8 渲染：使用 webgl 子对象获取 Shader 常量
        var WGL = window.spine38 && window.spine38.webgl;
        if (!WGL || !WGL.Shader) return;
        if (pp._shader && pp._batcher && pp._skeletonRenderer && pp._mvp) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            pp._shader.bind();
            pp._shader.setUniformi(WGL.Shader.SAMPLER, 0);
            pp._shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, pp._mvp.values);
            pp._batcher.begin(pp._shader);
            pp._skeletonRenderer.premultipliedAlpha = pp._premultipliedAlpha || false;
            pp._skeletonRenderer.draw(pp._batcher, pp.skeleton);
            pp._batcher.end();
            pp._shader.unbind();
        }
    }
};

// ---- 销毁预览资源 ----
SMTool._destroyAnimPreview = function () {
    var pp = SMData._animPreview;
    if (!pp) return;

    if (pp.state) { try { pp.state.clearTracks(); } catch (e) {} }
    if (pp._sceneRenderer) { try { pp._sceneRenderer.dispose(); } catch (e) {} }
    if (pp._batcher) { try { pp._batcher.dispose(); } catch (e) {} }
    if (pp._shader) { try { pp._shader.dispose(); } catch (e) {} }

    // ★ 直接销毁预览专属纹理（独立 GL 上下文，不在共享缓存中）
    if (pp._glTextures) {
        for (var i = 0; i < pp._glTextures.length; i++) {
            try { pp._glTextures[i].dispose(); } catch (e) {}
        }
    }

    // 重置状态
    pp.canvas = null;
    pp.gl = null;
    pp.skeleton = null;
    pp.state = null;
    pp.animName = '';
    pp.nodeId = null;
    pp._sceneRenderer = null;
    pp._batcher = null;
    pp._shader = null;
    pp._glTextures = [];
    pp._texImgs = [];
    pp._texCacheKeys = [];
    pp._atlasData = null;
    pp._skeletonData = null;
    pp._skeletonRenderer = null;
    pp._mvp = null;
    pp._boundsOffset = null;
    pp._boundsSize = null;
    pp._premultipliedAlpha = false;
    pp._lastTime = 0;
};

// ---- 更新预览动画（完整轨道混合复制） ----
SMTool._updateAnimPreviewAnim = function (animName) {
    var pp = SMData._animPreview;
    if (!pp || !pp.visible || !pp.state || !pp._skeletonData) return;

    // 从源节点读取完整的轨道配置
    var node = SMData.nodes.get(pp.nodeId);
    if (!node || !node.state) return;

    // ★ 完整复制源节点的轨道混合配置
    SMTool._applyPreviewTracks(pp, pp.state, new (SMTool._getSpineRuntime(pp._spineVer)).AnimationStateData(pp._skeletonData), pp._skeletonData, node);
    pp.animName = node.currentAnim || animName;

    // ★ 同步 PMA 和皮肤
    SMTool._syncPreviewPmaAndSkin(pp, node);

    var title = document.getElementById('appTitle');
    if (title) title.textContent = '🎬 ' + pp.animName;
};

// ---- 将源节点的轨道混合配置复制到预览 AnimationState ----
SMTool._applyPreviewTracks = function (pp, previewState, stateData, skeletonData, sourceNode) {
    previewState.clearTracks();

    var tracks = sourceNode.tracks;
    if (!tracks || tracks.length === 0) {
        // 没有轨道配置 → 只播放 currentAnim
        var anim = sourceNode.currentAnim || (sourceNode.animations[0] && sourceNode.animations[0].name) || '';
        if (anim) {
            previewState.setAnimation(0, anim, sourceNode.loop !== false);
        }
        pp.animName = anim;
        return;
    }

    var is4x = (pp._spineVer === '4.3' || pp._spineVer === '4.2');

    for (var ti = 0; ti < tracks.length; ti++) {
        var track = tracks[ti];
        if (!track.enabled || !track.animName) continue;

        // 验证动画存在于骨架中
        var animExists = false;
        for (var ai = 0; ai < skeletonData.animations.length; ai++) {
            if (skeletonData.animations[ai].name === track.animName) { animExists = true; break; }
        }
        if (!animExists) continue;

        var entry = previewState.setAnimation(ti, track.animName, track.loop !== false);
        if (entry) {
            if (track.alpha !== undefined && track.alpha >= 0 && track.alpha <= 1) {
                entry.alpha = track.alpha;
            }
            if (is4x && track.mixBlend) {
                entry.mixBlend = SMTool._mixBlendValue(track.mixBlend);
            }
            // ★ 同步混合过渡时间
            if (track.mixDuration !== undefined && track.mixDuration > 0) {
                entry.mixDuration = track.mixDuration;
            }
        }
    }

    pp.animName = sourceNode.currentAnim || (tracks.length > 0 ? tracks[0].animName : '');
};

// ---- 同步预览浮窗的 PMA 和皮肤到源节点状态 ----
SMTool._syncPreviewPmaAndSkin = function (pp, sourceNode) {
    if (!pp || !pp.skeleton || !pp._skeletonData || !sourceNode) return;

    // ★ 同步 PMA（3.8 通过 skeletonRenderer 标志；4.x 已烘焙到纹理，运行时不可变更）
    if (sourceNode.premultipliedAlpha !== undefined && pp._spineVer !== '4.3' && pp._spineVer !== '4.2') {
        pp._premultipliedAlpha = !!sourceNode.premultipliedAlpha;
    }

    // ★ 同步皮肤：从源节点 currentSkin 找到对应皮肤对象并应用到预览骨架
    var skinName = sourceNode.currentSkin;
    if (skinName && pp._skeletonData.skins) {
        var skin = null;
        for (var i = 0; i < pp._skeletonData.skins.length; i++) {
            if (pp._skeletonData.skins[i].name === skinName) {
                skin = pp._skeletonData.skins[i];
                break;
            }
        }
        if (skin) {
            pp.skeleton.setSkin(skin);
            pp.skeleton.setSlotsToSetupPose();
        }
    }
};

SMTool._syncZoomUI = function () {
    var pct = Math.round(SMData.view.zoom * 100);
    document.getElementById('zoomLabel').textContent = pct + '%';
    var slider = document.getElementById('zoomSlider');
    var sliderVal = Math.round(pct);
    if (sliderVal < 0) sliderVal = 0;
    if (sliderVal > 200) sliderVal = 200;
    if (Math.abs(parseInt(slider.value) - sliderVal) > 1) slider.value = sliderVal;
    // 非 100% 时显示恢复按钮
    var btn = document.getElementById('zoomResetBtn');
    if (btn) btn.style.display = (pct !== 100) ? '' : 'none';
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
