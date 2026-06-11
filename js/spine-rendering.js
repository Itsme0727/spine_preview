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
            wrap.style.width = (cw - 8) + 'px';
            wrap.style.height = ch + 'px';
        }
    }

    node._canvasWidth = cw - 4;
    node._canvasHeight = ch;
    // 节点有 border: 2px 左右各 2px，内容宽度 = 总宽 - 4px
    node.width = Math.max(cw, node.width, 260);
    if (nodeEl) nodeEl.style.width = (node.width - 4) + 'px';

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

    var gl = SMTool._sharedGL;
    if (!gl) return;

    var WGL38 = window.spine38 && window.spine38.webgl;
    var sharedCanvas = SMTool._sharedCanvas;
    var cwFull = sharedCanvas.width;
    var chFull = sharedCanvas.height;

    // ---- 视口裁剪：计算当前可见的世界坐标范围 ----
    var z = SMData.view.zoom;
    var vx = SMData.view.x;
    var vy = SMData.view.y;
    var vpW = cwFull / z;
    var vpH = chFull / z;
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

    // ★ 优化：合并统计与渲染为一次遍历
    var doStats = (now - SMTool._ft >= 1000);
    var totalDraws = 0, totalBones = 0;

    // ★ 优化：没有需要渲染的节点时跳过全清操作
    var hasVisibleNode = false;

    // ★ 先遍历检查是否有可见节点，无则跳过整帧 WebGL 操作
    var previewCheckIter = SMData.nodes.values();
    var previewCheck = previewCheckIter.next();
    while (!previewCheck.done) {
        var pcNode = previewCheck.value;
        if (pcNode.state && pcNode.skeleton && pcNode._canvasWidth) {
            hasVisibleNode = true;
            break;
        }
        previewCheck = previewCheckIter.next();
    }

    if (!hasVisibleNode) {
        // 无任何可渲染节点 → 仅更新 2D 画布，跳过 WebGL 清屏
        if (doStats) {
            document.getElementById('sbFPS').textContent = 'FPS: --';
            document.getElementById('sbBones').textContent = '骨骼: 0';
            document.getElementById('sbDraws').textContent = 'Draw call: 0';
            SMTool._fc = 0; SMTool._ft = now;
        }
        SMTool._renderSnapLines();
        if ((SMTool._fc & 3) === 0) SMTool._renderMinimap();
        return;
    }
    hasVisibleNode = false; // 重置，后续真正遍历时再标记

    // 每帧全清画布（仅当有节点需要渲染时）
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, cwFull, chFull);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // ★ 优化：帧级 GL 混合状态初始化（仅一次，不再逐节点重复）
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // ★ 优化：缓存 ManagedWebGLRenderingContext 能力检测（仅首次）
    if (SMTool._mcBlendFuncCap === undefined) {
        var mcCheck = SMTool._sharedManagedContext4x;
        if (mcCheck) {
            SMTool._mcBlendFuncCap = (typeof mcCheck.blendFunc === 'function');
            SMTool._mcBlendSrcProp = (mcCheck._blendSrc !== undefined) ? '_blendSrc' : ((mcCheck._cachedBlendSrc !== undefined) ? '_cachedBlendSrc' : null);
            SMTool._mcBlendDstProp = SMTool._mcBlendSrcProp ? SMTool._mcBlendSrcProp.replace('Src', 'Dst') : null;
        } else {
            SMTool._mcBlendFuncCap = false;
            SMTool._mcBlendSrcProp = null;
            SMTool._mcBlendDstProp = null;
        }
    }

    gl.enable(gl.SCISSOR_TEST);

    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var node = result.value;

        // ★ 快速跳过：无渲染数据的节点
        if (!node.state || !node.skeleton || !node._canvasWidth) {
            result = nodesIter.next(); continue;
        }

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

        var nodeW = node._debugCanvasW || node._canvasWidth;
        var nodeH = node._debugCanvasH || node._canvasHeight;
        var nodeScale = (node._customScale !== undefined ? node._customScale : 1.0);
        var scaledW = nodeW * nodeScale;
        var scaledH = nodeH * nodeScale;

        // ★ 优化：统计骨骼/Draw（合并到主循环，避免二次遍历）
        if (doStats && node.skeleton) {
            totalBones += node.bones.length;
            totalDraws += (node.skeleton.drawOrder ? node.skeleton.drawOrder.length : 0);
        }

        if (node.x + scaledW < frzLeft || node.x > frzRight ||
            node.y + scaledH < frzTop || node.y > frzBottom) {
            node._visible = false; result = nodesIter.next(); continue;
        }
        node._visible = true;
        hasVisibleNode = true;

        var sp = SMTool.worldToCanvas(node.x, node.y);
        var sx = Math.round(sp.x), sy = Math.round(sp.y);
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

        // 🔒 [LOCK-5] 渲染循环看门狗：仅修复 timeScale=0 残留冻结
        // 触发条件：面板未展开 且 流未播放（正常模式下的异常残留修复）
        // 规则：只解冻 timeScale，不做 _applyTracksToState（避免重置正常动画）
        if (node.state && node.skeletonData && !SMData._flowPanel.expanded && !SMData._fullPlayback.isPlaying) {
            try {
                for (var wdi = 0; wdi < 5; wdi++) {
                    var wdEntry = node.state.getCurrent(wdi);
                    if (wdEntry && wdEntry.timeScale === 0) {
                        wdEntry.timeScale = 1.0;
                    }
                }
            } catch (e) {}
        }

        // 动画更新：动态模式始终 60fps，性能模式 <20% 冻结，静态模式仅选中节点播放
        var isFlowPlaying = SMData._fullPlayback && SMData._fullPlayback.isPlaying;
        var isPlayingNode = isFlowPlaying && SMData._fullPlayback.activePathIdx >= 0 &&
            SMData._fullPaths[SMData._fullPlayback.activePathIdx] &&
            SMData._fullPaths[SMData._fullPlayback.activePathIdx].nodes[SMData._fullPlayback.currentStep] &&
            SMData._fullPaths[SMData._fullPlayback.activePathIdx].nodes[SMData._fullPlayback.currentStep].id === node.id;
        var isSelectedNode = SMData.selectedNodes.has(node.id);
        var shouldAnimate = false;
        if (SMData.renderMode === 'static') {
            shouldAnimate = isSelectedNode || isPlayingNode;
        } else {
            shouldAnimate = (SMData.renderMode === 'dyn' || z >= 0.20 || isPlayingNode);
        }
        if (shouldAnimate) {
            node.state.update(dt);
            node.state.apply(node.skeleton);

            // ★ 事件帧气泡：用本地循环时间（trackTime % duration）检测跨帧
            SMTool._ensureEventFrames(node);
            if (node._eventFrames && node._eventFrames.length > 0) {
                var trackEntry = node.state.getCurrent(0);
                if (trackEntry) {
                    var anim = trackEntry.animation || trackEntry._animation;
                    var duration = anim ? anim.duration : 1;
                    // trackTime 跨循环累加，取模得到当前循环内的时间
                    var rawTime = trackEntry.trackTime;
                    var curTime = rawTime % Math.max(duration, 0.001);
                    var prevTime = node._lastEventCheckTime || 0;
                    // 检测循环：当前本地时间 < 上次 说明动画已重新开始
                    if (curTime < prevTime - 0.001) prevTime = 0;
                    for (var efi = 0; efi < node._eventFrames.length; efi++) {
                        var ef = node._eventFrames[efi];
                        if (ef.time >= prevTime && ef.time <= curTime) {
                            SMTool._showEventBubble(node, ef);
                        }
                    }
                    node._lastEventCheckTime = curTime;
                }
            }
        }
        node.skeleton.updateWorldTransform(node._physParam);

        // ★ 防御：修复 skeleton 根位置 NaN（空默认皮肤的 spine 文件可能出现）
        if (isNaN(node.skeleton.x)) node.skeleton.x = 0;
        if (isNaN(node.skeleton.y)) node.skeleton.y = 0;
        if (isNaN(node.skeleton.scaleX)) node.skeleton.scaleX = 1;
        if (isNaN(node.skeleton.scaleY)) node.skeleton.scaleY = 1;

        // ★ 调试偏移：在自然位置上叠加用户拖拽的位移
        if (node._debugOffsetX || node._debugOffsetY) {
            if (node._baseSkX === undefined) { node._baseSkX = node.skeleton.x; node._baseSkY = node.skeleton.y; }
            node.skeleton.x = (node._baseSkX || 0) + (node._debugOffsetX || 0);
            node.skeleton.y = (node._baseSkY || 0) + (node._debugOffsetY || 0);
            node.skeleton.updateWorldTransform(node._physParam);
        }

        var glY = chFull - sy - sh;
        gl.scissor(sx, glY, sw, sh);
        gl.viewport(sx, glY, sw, sh);
        gl.clearColor(0, 0, 0, 0);
        gl.clearStencil(0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

        // ★ 优化：同步 batcher 内部混合状态（帧级已重置 GL，此处仅同步缓存）
        if (node.batcher) {
            node.batcher.srcBlend = gl.ONE;
            node.batcher.dstBlend = gl.ONE_MINUS_SRC_ALPHA;
        }

        // ★ 优化：同步 ManagedWebGLRenderingContext（使用缓存的能力检测）
        var mcSync = SMTool._sharedManagedContext4x;
        if (mcSync && SMTool._mcBlendFuncCap) {
            mcSync.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        } else if (mcSync && SMTool._mcBlendSrcProp) {
            mcSync[SMTool._mcBlendSrcProp] = gl.ONE;
            mcSync[SMTool._mcBlendDstProp] = gl.ONE_MINUS_SRC_ALPHA;
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
            // ★ 传递节点的 PMA 设置（4.x drawSkeleton 第2参数）
            node.sceneRenderer.drawSkeleton(node.skeleton, node.premultipliedAlpha);
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

        // ★ 渲染骨骼挂图（可被左上角"挂点"按钮隐藏）
        if (!SMData._hideBoneImgs) {
            SMTool._renderNodeBoneImages(node, gl, nodeW, nodeH, sx, glY, sw, sh);
        }

        result = nodesIter.next();
    }

    gl.disable(gl.SCISSOR_TEST);

    // ★ 优化：统计（合并到主循环，无需二次遍历）
    if (doStats) {
        document.getElementById('sbFPS').textContent = 'FPS: ' + Math.round(SMTool._fc * 1000 / (now - SMTool._ft));
        if (performance.memory) {
            var mb = (performance.memory.totalJSHeapSize / 1048576).toFixed(1);
            document.getElementById('sbMemory').textContent = '内存: ' + mb + 'MB';
        }
        document.getElementById('sbBones').textContent = '骨骼: ' + totalBones;
        document.getElementById('sbDraws').textContent = 'Draw call: ' + totalDraws;
        SMTool._fc = 0;
        SMTool._ft = now;
    }

    // ★ 优化：2D Canvas 脏标记 — 仅在视图/连线变化时重绘网格和连线
    // 但以下情况必须每帧重绘：框选拖拽中、连线拖拽中、控制点拖拽中、标签拖拽中
    var viewChanged = (SMData.view.zoom !== SMData._lastViewZoom ||
        SMData.view.x !== SMData._lastViewX || SMData.view.y !== SMData._lastViewY);
    var connChanged = (SMData.connections.length !== SMData._lastConnCount) || viewChanged;
    var selChanged = (SMData.selectedConnection !== SMData._lastSelConn) || (SMData.selectedNodes.size !== SMData._lastSelCount);
    var needsRedraw = viewChanged || connChanged || selChanged || SMData._forceRedraw ||
        SMData.marqueeActive || SMData.connecting || SMData.draggingCP || SMData.draggingLabel ||
        SMData.isPanning || SMData.draggedNode || SMData.isMultiDragging;

    if (needsRedraw) {
        SMData._lastViewZoom = SMData.view.zoom;
        SMData._lastViewX = SMData.view.x;
        SMData._lastViewY = SMData.view.y;
        SMData._lastConnCount = SMData.connections.length;
        SMData._lastSelConn = SMData.selectedConnection;
        SMData._lastSelCount = SMData.selectedNodes.size;
        SMData._forceRedraw = false;

        // ★ 防御：连线渲染依赖 getBoundingClientRect() 读取 DOM 端点位置。
        // 若 _updateAllPos 还在 rAF 队列中未执行（缩放/平移触发的延迟更新），
        // 则 DOM 位置是旧的，而 view.zoom/x/y 已更新，canvasToWorld 换算会错位。
        // 此处强制同步刷新 DOM，确保连线端点坐标与 WebGL 画面一致。
        if (viewChanged && SMTool._allPosScheduled) {
            SMTool._allPosScheduled = false;
            SMTool._allPosQueued = false;
            SMTool._updateAllPosCore();
        }

        SMTool._renderGrid();
        SMTool._renderGroupBoxes(SMTool.gridCtx);
        SMTool._renderConnections();
    }
    SMTool._renderSnapLines();
    // ★ 优化：鸟瞰图每 4 帧渲染一次（约 15fps），减少 2D canvas 开销
    if ((SMTool._fc & 3) === 0) SMTool._renderMinimap();
    SMTool._renderAnimPreview(now);
};

// ---- 缩放 ----
SMTool._onWheel = function (e) {
    // ★ 调试模式：滚轮缩放动画层
    if (SMData._debugMode) {
        e.preventDefault();
        var dm = SMData._debugMode;
        var node = SMData.nodes.get(dm.nodeId);
        if (node) {
            var factor = e.deltaY > 0 ? 0.935 : 1.065;
            var newScale = (node._customScale || 1.0) * factor;
            newScale = Math.max(0.2, Math.min(5.0, newScale));
            node._customScale = newScale;
            SMTool._syncDebugToSameSource(node);
            SMTool._updateDebugBar(node);
        }
        return;
    }

    var oz = SMData.view.zoom;
    var factor = e.deltaY > 0 ? 0.935 : 1.065;
    SMData.view.zoom = Math.max(0.03, Math.min(5, SMData.view.zoom * factor));
    var mx = e.clientX - window.innerWidth / 2;
    var my = e.clientY - window.innerHeight / 2;
    SMData.view.x += mx * (1 / SMData.view.zoom - 1 / oz);
    SMData.view.y += my * (1 / SMData.view.zoom - 1 / oz);
    // ★ forceSync=true：缩放时必须同步更新 DOM 位置，
    // 否则下一帧 _renderConnections 用新 zoom 读旧 DOM 位置会算出错误坐标
    SMTool._updateAllPos(true);
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
    // ★ forceSync=true：缩放滑块同样需要同步更新 DOM
    SMTool._updateAllPos(true);
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

    // ================================================================
    // 🔒🔒🔒 [LOCK-B] 阻止渲染循环在 setup 完成前绘制
    // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
    //    如需修改，一定要寻求同意"解锁"才可以。
    //
    // 若此旗标不设，render 可能抓到 setup 中间态（skeleton 已赋值但 state 未配置），
    // 导致短暂显示 T-pose / setup pose 等错误画面。
    // ================================================================
    pp._readyToRender = false;

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

    // 设置面板尺寸和画布（保留用户缩放后的尺寸，首次默认 280×420）
    var savedW = pp.panelW || 320;
    var savedH = pp.panelH || 500;
    panel.style.width = savedW + 'px';
    panel.style.height = savedH + 'px';
    // ★ 等 DOM 布局完成后，取 canvas 实际容器尺寸（排除标题栏），避免拉伸
    var wrap = canvas.parentElement;
    var actualW = wrap ? wrap.clientWidth : savedW;
    var actualH = wrap ? wrap.clientHeight : savedH;
    if (actualW < 10) actualW = savedW;
    if (actualH < 10) actualH = savedH;
    canvas.width = actualW;
    canvas.height = actualH;
    pp.canvas = canvas;
    pp.panelW = savedW;
    pp.panelH = savedH;

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

    // ================================================================
    // 🔒🔒🔒 [LOCK-2] 预览贴图校验 dataUrl
    // ⚠️ 解锁策略：除非用户明确说「解锁 LOCK-2」，或我主动问询
    //    「是否解锁 LOCK-2 以修改XX功能」且用户同意，否则绝不改动此块。
    //
    // 不能仅凭 _texImgs[pi] 存在就复用，必须比对 dataUrl 一致。
    // 否则切换不同文件时 B 预览会错拿 A 贴图。
    // ================================================================
    var imgs = [];
    var needLoad = false;
    for (var pi = 0; pi < pageDataUrls.length; pi++) {
        var existingImg = null;
        var targetUrl = pageDataUrls[pi].dataUrl;
        // 必须校验同 dataUrl，防止跨文件错拿贴图
        var nodesIter2 = SMData.nodes.values();
        var r2 = nodesIter2.next();
        while (!r2.done) {
            var nd = r2.value;
            var ndUrls = nd._srcTexDataUrls;
            var ndUrl = (ndUrls && ndUrls[pi]) ? ndUrls[pi].dataUrl : (pi === 0 ? nd._srcTexDataUrl : '');
            if (ndUrl === targetUrl && nd._texImgs && nd._texImgs[pi]) {
                existingImg = nd._texImgs[pi];
                break;
            }
            if (ndUrl === targetUrl && nd.textureImg && pi === 0) {
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
            img.src = targetUrl;
            imgs[pi] = img;
        }
    }
    // 🔒 [LOCK-2] END

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
            // ★ 优先使用源节点当前皮肤，回退到默认皮肤
            var previewSkin = null;
            var skinName = node.currentSkin;
            if (skinName) {
                for (var ski = 0; ski < sd.skins.length; ski++) {
                    if (sd.skins[ski].name === skinName) { previewSkin = sd.skins[ski]; break; }
                }
            }
            if (previewSkin) {
                sk.setSkin(previewSkin);
            } else if (sd.defaultSkin) {
                sk.setSkin(sd.defaultSkin);
            }
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
            // ★ 保留已有的内容缩放（不同源文件重建时继承用户缩放级别）
            pp._contentZoom = pp._contentZoom || 1.0;
            var zoom = pp._contentZoom;
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
                renderer.camera.viewportWidth = cw / zoom;
                renderer.camera.viewportHeight = ch / zoom;
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
                pp._mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);

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

            // ================================================================
            // 🔒🔒🔒 [LOCK-C] pp.state 必须在 _applyPreviewTracks 之后赋值
            // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
            //    如需修改，一定要寻求同意"解锁"才可以。
            //
            // 若先赋值 pp.state 再调 _applyPreviewTracks，渲染循环可能在中间帧
            // 抓到空的 AnimationState（0 条轨道），apply 后骨架跳回 setup pose。
            // ================================================================
            var stateData = new SP.AnimationStateData(sd);
            var state = new SP.AnimationState(stateData);
            // 复制源节点的全部轨道配置（不只是 track 0）
            SMTool._applyPreviewTracks(pp, state, stateData, sd, node);
            // ★ 先配置好动画再设置 pp.state，避免空状态帧闪烁
            pp.state = state;
            // 🔒 [LOCK-C] END

            state.update(0);
            state.apply(sk);
            // ★ 防御 NaN
            if (isNaN(sk.x)) sk.x = 0;
            if (isNaN(sk.y)) sk.y = 0;
            sk.updateWorldTransform(physParam);
            // ★ 动画后重新计算边界居中（仅空默认皮肤文件，setup pose 无边）
            var setupBoundsValid = pp._boundsOffset && pp._boundsSize &&
                isFinite(pp._boundsOffset.x) && isFinite(pp._boundsSize.x) && pp._boundsSize.x > 0;
            if (!setupBoundsValid) {
                var animOff2 = new SP.Vector2();
                var animSize2 = new SP.Vector2();
                try {
                    // 尝试多个时间点（有些动画首帧不在 t=0）
                    var tryTimes2 = [0];
                    var entry2 = state.getCurrent(0);
                    if (entry2) {
                        var dur2 = (entry2.animation && entry2.animation.duration) || (entry2._animation && entry2._animation.duration) || 1;
                        tryTimes2.push(dur2 * 0.5, dur2 * 0.25);
                    }
                    var foundBounds2 = false;
                    for (var t2 = 0; t2 < tryTimes2.length; t2++) {
                        if (entry2) { entry2.trackTime = tryTimes2[t2]; }
                        state.apply(sk);
                        sk.updateWorldTransform(physParam);
                        if (typeof sk.getBounds === 'function') {
                            sk.getBounds(animOff2, animSize2, []);
                        } else {
                            SMTool._computeBoundsManually(sk, animOff2, animSize2);
                        }
                        if (isFinite(animOff2.x) && isFinite(animSize2.x) && animSize2.x > 0) {
                            foundBounds2 = true;
                            break;
                        }
                    }
                    // 重置回时间 0
                    if (entry2) { entry2.trackTime = 0; }
                    state.apply(sk);
                    if (foundBounds2) {
                        sk.x = cw / 2 - (animOff2.x + animSize2.x / 2);
                        sk.y = ch / 2 - (animOff2.y + animSize2.y / 2);
                        pp._boundsOffset = { x: animOff2.x, y: animOff2.y };
                        pp._boundsSize = { x: animSize2.x, y: animSize2.y };
                    } else {
                        sk.x = 0; sk.y = 0;
                    }
                } catch (e2) {}
                sk.updateWorldTransform(physParam);
            }

            pp.nodeId = node.id;
            pp._lastTime = performance.now();

            // ★ 同步源节点的 PMA 和皮肤设置
            SMTool._syncPreviewPmaAndSkin(pp, node);

            // ================================================================
            // 🔒🔒🔒 [LOCK-D] 就绪旗标 + 同步渲染首帧
            // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
            //    如需修改，一定要寻求同意"解锁"才可以。
            //
            // visible=true 和 _readyToRender=true 必须一同设置，
            // 紧跟同步渲染确保画布在调用方显示面板前已绘制完成。
            // 若去掉同步渲染或拆分旗标设置，旧画面可能残留或被空白帧替代。
            // ================================================================
            pp.visible = true;
            pp._readyToRender = true;
            SMTool._renderAnimPreview(performance.now());
            // 🔒 [LOCK-D] END

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
    // ★ 层级节点预览（含测试模式）：多层叠加渲染
    if (pp && pp.visible && pp._layerSkeletons && pp._layerSkeletons.length > 0) {
        if (!pp._readyToRender || !pp.gl) return;
        SMTool._renderLayerPreview(null, pp, now);
        return;
    }
    // ================================================================
    // 🔒🔒🔒 [LOCK-E] _readyToRender 守卫检查
    // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
    //    如需修改，一定要寻求同意"解锁"才可以。
    //
    // _readyToRender 为 false 时禁止渲染，防止抓到 setup 中间态。
    // 必须与 [LOCK-B][LOCK-D] 配合，三者构成完整的安全屏障。
    // ================================================================
    if (!pp || !pp.visible || !pp._readyToRender || !pp.state || !pp.skeleton || !pp.gl) return;
    // 🔒 [LOCK-E] END

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
                // ★ SceneRenderer 需要 begin/end 包围 drawSkeleton 才能刷出画面
                pp._sceneRenderer.begin();
                pp._sceneRenderer.drawSkeleton(pp.skeleton, pp._premultipliedAlpha || false);
                pp._sceneRenderer.end();
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

    // ★ 渲染预览浮窗骨骼挂图
    SMTool._renderPreviewBoneImages(pp);
};

// ---- 同步预览面板视口（缩放面板时调用，重新计算相机/投影/骨架位置） ----
SMTool._syncAnimPreviewViewport = function (pp, newW, newH) {
    if (!pp || !pp.skeleton || !pp.gl) return;

    var canvas = pp.canvas;
    // ★ 取 canvas 容器的实际像素尺寸（排除标题栏），避免拉伸
    var wrap = canvas ? canvas.parentElement : null;
    var actualW = (wrap && wrap.clientWidth > 10) ? wrap.clientWidth : (newW || pp._canvasWidth || 320);
    var actualH = (wrap && wrap.clientHeight > 10) ? wrap.clientHeight : (newH || pp._canvasHeight || 500);
    if (canvas) {
        canvas.width = actualW;
        canvas.height = actualH;
    }
    pp._canvasWidth = actualW;
    pp._canvasHeight = actualH;

    // ★ 用实际 canvas 尺寸（非面板尺寸）做 ortho 和居中
    var cw = actualW, ch = actualH;
    var sk = pp.skeleton;
    var useVer = pp._spineVer;
    var bo = pp._boundsOffset;
    var bs = pp._boundsSize;
    var zoom = pp._contentZoom || 1.0;

    // 重新居中骨架
    if (bo && bs) {
        sk.x = cw / 2 - (bo.x + bs.x / 2);
        sk.y = ch / 2 - (bo.y + bs.y / 2);
    }

    // 更新相机/投影矩阵（含内容缩放）
    if (useVer === '4.3' || useVer === '4.2') {
        if (pp._sceneRenderer) {
            pp._sceneRenderer.camera.position.set(cw / 2, ch / 2, 0);
            pp._sceneRenderer.camera.viewportWidth = cw / zoom;
            pp._sceneRenderer.camera.viewportHeight = ch / zoom;
            pp._sceneRenderer.camera.update();
        }
    } else {
        if (pp._mvp) {
            pp._mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);
        }
    }

    // ★ 更新缩放标签
    SMTool._updateAnimPreviewZoomLabel(zoom);
};

// ---- 更新缩放标签 ----
SMTool._updateAnimPreviewZoomLabel = function (zoom) {
    var label = document.getElementById('appZoomLabel');
    if (label) {
        var pct = Math.round(zoom * 100);
        label.textContent = pct + '%';
        // 非 100% 时高亮显示
        var bar = document.getElementById('appZoomBar');
        if (bar) {
            if (pct === 100) {
                bar.classList.remove('visible');
            } else {
                bar.classList.add('visible');
            }
        }
    }
};

// ---- 重置预览缩放为 100% ----
SMTool._resetAnimPreviewZoom = function () {
    var pp = SMData._animPreview;
    if (!pp || !pp.visible) return;
    pp._contentZoom = 1.0;
    // 🔒 [LOCK-1] 重置按钮回写 100% 到文件记录
    var sourceNode = SMData.nodes.get(pp.nodeId);
    if (sourceNode && sourceNode.sourceFile) {
        SMData._previewZooms[sourceNode.sourceFile] = 1.0;
    }
    // ★ 层级预览重置
    if (pp._layerSkeletons && pp._layerSkeletons.length > 0 && pp.nodeId) {
        SMData._previewZooms['_layer_' + pp.nodeId] = 1.0;
        SMTool._syncLayerPreviewViewport(pp);
        return;
    }
    var cw = pp._canvasWidth || pp.panelW || 320;
    var ch = pp._canvasHeight || pp.panelH || 500;
    SMTool._syncAnimPreviewViewport(pp, cw, ch);
};

// ---- 销毁预览资源 ----
SMTool._destroyAnimPreview = function () {
    var pp = SMData._animPreview;
    if (!pp) return;

    // ================================================================
    // 🔒🔒🔒 [LOCK-A] 销毁预览时禁止 gl.clear()
    // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
    //    如需修改，一定要寻求同意"解锁"才可以。
    //
    // 销毁时清空画布会导致浏览器在同一帧合成空白画面，
    // 下一帧才渲染新内容 → 用户看到闪烁/切屏。
    // 旧画面必须保留在画布上，由新内容首帧渲染自然覆盖。
    // ================================================================

    if (pp.state) { try { pp.state.clearTracks(); } catch (e) {} }
    if (pp._sceneRenderer) { try { pp._sceneRenderer.dispose(); } catch (e) {} }
    if (pp._batcher) { try { pp._batcher.dispose(); } catch (e) {} }
    if (pp._shader) { try { pp._shader.dispose(); } catch (e) {} }

    // ★ 销毁层级节点预览的多层骨架资源
    if (pp._layerSkeletons) {
        for (var ls = 0; ls < pp._layerSkeletons.length; ls++) {
            var lsk = pp._layerSkeletons[ls];
            if (lsk.batcher) { try { lsk.batcher.dispose(); } catch (e) {} }
            if (lsk.shader) { try { lsk.shader.dispose(); } catch (e) {} }
            if (lsk.skeletonRenderer) { try { lsk.skeletonRenderer.dispose(); } catch (e) {} }
            if (lsk.glTextures) {
                for (var gt = 0; gt < lsk.glTextures.length; gt++) {
                    try { lsk.glTextures[gt].dispose(); } catch (e) {}
                }
            }
        }
        pp._layerSkeletons = null;
    }
    pp._layerPreview = false;

    // ★ 直接销毁预览专属纹理（独立 GL 上下文，不在共享缓存中）
    if (pp._glTextures) {
        for (var i = 0; i < pp._glTextures.length; i++) {
            try { pp._glTextures[i].dispose(); } catch (e) {}
        }
    }
    // ★ 销毁预览专属骨骼挂图资源（独立 GL 上下文）
    if (pp._boneTexCache && pp.gl) {
        var btcKeys = Object.keys(pp._boneTexCache);
        for (var b = 0; b < btcKeys.length; b++) {
            try { pp._boneTexCache[btcKeys[b]].texture.dispose(); } catch (e) {}
        }
        pp._boneTexCache = null;
    }
    if (pp._boneQR && pp.gl) {
        try { pp.gl.deleteProgram(pp._boneQR.prog); } catch (e) {}
        try { pp.gl.deleteBuffer(pp._boneQR.vbo); } catch (e) {}
        pp._boneQR = null;
    }

    // 重置状态
    pp._readyToRender = false;
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
    // ★ 清除轨道后立刻重置骨骼到绑定姿态，防止上一动画最后一帧残留闪烁
    if (pp.skeleton) pp.skeleton.setToSetupPose();

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

    // ▲ flow 播放时强制不循环（flow 控制节奏）；非 flow 时跟随节点自身循环设置
    if (SMData._fullPlayback && SMData._fullPlayback.isPlaying) {
        for (var ti = 0; ti < 5; ti++) {
            var e = previewState.getCurrent(ti);
            if (e) e.loop = false;
        }
    }

    // ★ 立即应用第一帧，消除 setup pose 闪烁
    previewState.update(0);
    previewState.apply(pp.skeleton);
    pp.skeleton.updateWorldTransform(pp._physParam);
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
    // ★ forceSync=true：缩放变化必须同步更新 DOM
    SMTool._updateAllPos(true);
    SMTool._syncZoomUI();
};

SMTool.resetView = function () {
    SMData.view = { x: 0, y: 0, zoom: 1 };
    // ★ forceSync=true：缩放变化必须同步更新 DOM
    SMTool._updateAllPos(true);
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

// ================================================================
// ★ 事件帧气泡提示 — 动画播放到事件帧时在节点旁弹出气泡
// ================================================================

// 提取节点的当前动画事件帧数据（缓存到 node._eventFrames，动画切换时自动重建）
SMTool._ensureEventFrames = function (node) {
    var animName = node.currentAnim || (node.animations.length > 0 ? node.animations[0].name : '');
    // 动画名变了 → 清缓存重建
    if (node._eventFrames && node._cachedEventAnim === animName) return;
    node._eventFrames = null;
    node._cachedEventAnim = animName;
    node._lastEventCheckTime = 0;
    if (!node.skeletonData) return;
    var animName = node.currentAnim || (node.animations.length > 0 ? node.animations[0].name : '');
    if (!animName) return;
    var sd = node.skeletonData;
    var anim = null;
    for (var ai = 0; ai < sd.animations.length; ai++) {
        if (sd.animations[ai].name === animName) { anim = sd.animations[ai]; break; }
    }
    if (!anim) return;
    var frames = [];
    var timelines = anim.timelines || (typeof anim.getTimelines === 'function' ? anim.getTimelines() : []);
    for (var ti = 0; ti < timelines.length; ti++) {
        var tl = timelines[ti];
        if (!tl.frames || !tl.events) continue;
        for (var fi = 0; fi < tl.events.length; fi++) {
            var evt = tl.events[fi];
            var name = evt.data ? evt.data.name : (evt.name || '');
            if (!name) continue;
            frames.push({ time: tl.frames[fi] || 0, name: name });
        }
    }
    node._eventFrames = frames;
    node._lastEventCheckTime = 0;
};

// 显示事件气泡（复用节点上的气泡元素，避免反复创建DOM）
SMTool._showEventBubble = function (node, eventFrame) {
    var el = SMTool._getEl(node.id);
    if (!el) return;
    var bubble = el.querySelector('.event-bubble');
    if (!bubble) {
        bubble = document.createElement('div');
        bubble.className = 'event-bubble';
        bubble.innerHTML = '<span class="event-bubble-name"></span><span class="event-bubble-time"></span>';
        el.appendChild(bubble);
    }
    // 更新内容
    bubble.querySelector('.event-bubble-name').textContent = eventFrame.name;
    bubble.querySelector('.event-bubble-time').textContent = eventFrame.time.toFixed(2) + 's';
    // 重新触发动画：移除类→强制回流→加回类
    bubble.classList.remove('event-bubble');
    void bubble.offsetWidth;
    bubble.classList.add('event-bubble');
};

// ================================================================
// ★ 骨骼挂图渲染 — 将骨骼截图以程序化挂点方式绑定到 Spine 骨骼
//    跟随骨骼的位移/旋转/缩放，在动画节点和预览浮窗内实时渲染
// ================================================================

// 骨骼图片 GL 纹理缓存（主画布共享）
// { shotId: { texture, img, width, height } }
SMTool._boneTexCache = {};

// 骨骼挂图四边形渲染器（主画布）
SMTool._boneQR = null;

// ---- 编译骨骼挂图着色器程序 ----
SMTool._createBoneQuadRenderer = function (gl) {
    var vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, [
        'attribute vec2 a_pos;',
        'attribute vec2 a_uv;',
        'uniform mat4 u_mvp;',
        'varying vec2 v_uv;',
        'void main() {',
        '  gl_Position = u_mvp * vec4(a_pos, 0.0, 1.0);',
        '  v_uv = a_uv;',
        '}'
    ].join('\n'));
    gl.compileShader(vs);

    var fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, [
        'precision mediump float;',
        'varying vec2 v_uv;',
        'uniform sampler2D u_tex;',
        'uniform float u_alpha;',
        'void main() {',
        '  vec4 c = texture2D(u_tex, v_uv);',
        '  gl_FragColor = vec4(c.rgb, c.a * u_alpha);',
        '}'
    ].join('\n'));
    gl.compileShader(fs);

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('[BoneQR] Shader link failed:', gl.getProgramInfoLog(prog));
        gl.deleteProgram(prog);
        return null;
    }

    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    // 单位正方形，中心在原点：(pos.x, pos.y, uv.u, uv.v)
    // UV V 坐标翻转：WebGL texImage2D 上传 HTML Image 时第一行在顶部，
    // 而 GL 纹理坐标 (0,0) 指向纹理数据第一行，即图片顶部
    var verts = new Float32Array([
        -0.5, -0.5,  0.0, 1.0,
         0.5, -0.5,  1.0, 1.0,
        -0.5,  0.5,  0.0, 0.0,
         0.5,  0.5,  1.0, 0.0
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    return {
        prog: prog,
        vbo: vbo,
        aPos: gl.getAttribLocation(prog, 'a_pos'),
        aUV: gl.getAttribLocation(prog, 'a_uv'),
        uMVP: gl.getUniformLocation(prog, 'u_mvp'),
        uTex: gl.getUniformLocation(prog, 'u_tex'),
        uAlpha: gl.getUniformLocation(prog, 'u_alpha')
    };
};

// ---- 获取或创建骨骼图片的 GL 纹理 ----
SMTool._ensureBoneTexture = function (gl, shotId) {
    if (SMTool._boneTexCache[shotId]) return SMTool._boneTexCache[shotId].texture;

    var dataUrl = SMData._shotGetDataUrl ? SMData._shotGetDataUrl(shotId) : null;
    if (!dataUrl) return null;

    var img = new Image();
    img.src = dataUrl;

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // 占位 1x1 透明像素
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var entry = { texture: tex, img: img, uploaded: false };
    SMTool._boneTexCache[shotId] = entry;

    img.onload = function () {
        entry.uploaded = false; // 标记需要重新上传
    };

    return tex;
};

// ---- 上传已加载的图片到 GL 纹理 ----
SMTool._uploadBoneTexture = function (gl, shotId) {
    var entry = SMTool._boneTexCache[shotId];
    if (!entry || entry.uploaded || !entry.img || !entry.img.complete || !entry.img.width) return;
    try {
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        entry.uploaded = true;
    } catch (e) {
        // 跨域或其他错误，忽略
    }
};

// ---- 构建正交投影矩阵（Y-down，屏幕空间） ----
SMTool._orthoM4 = function (out, l, r, b, t, n, f) {
    out.fill(0);
    out[0] = 2 / (r - l);
    out[5] = 2 / (t - b);
    out[10] = -2 / (f - n);
    out[12] = -(r + l) / (r - l);
    out[13] = -(t + b) / (t - b);
    out[14] = -(f + n) / (f - n);
    out[15] = 1;
};

// ---- 构建 2D 模型矩阵（平移 + 旋转 + 缩放） ----
SMTool._modelM4 = function (out, tx, ty, angle, sx, sy) {
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    out.fill(0);
    out[0] = cos * sx;
    out[1] = sin * sx;
    out[4] = -sin * sy;
    out[5] = cos * sy;
    out[12] = tx;
    out[13] = ty;
    out[10] = 1;
    out[15] = 1;
};

// ---- 4x4 矩阵乘法：out = a * b ----
SMTool._mulM4 = function (out, a, b) {
    for (var i = 0; i < 4; i++) {
        for (var j = 0; j < 4; j++) {
            out[i + j * 4] = a[i] * b[j * 4] + a[i + 4] * b[1 + j * 4] + a[i + 8] * b[2 + j * 4] + a[i + 12] * b[3 + j * 4];
        }
    }
};

// ---- 保存关键 GL 状态 ----
SMTool._saveGL = function (gl) {
    return {
        prog: gl.getParameter(gl.CURRENT_PROGRAM),
        blend: gl.isEnabled(gl.BLEND),
        blendSrc: gl.getParameter(gl.BLEND_SRC_RGB),
        blendDst: gl.getParameter(gl.BLEND_DST_RGB),
        tex2D: gl.getParameter(gl.TEXTURE_BINDING_2D),
        activeTex: gl.getParameter(gl.ACTIVE_TEXTURE),
        arrBuf: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
        vp: gl.getParameter(gl.VIEWPORT)
    };
};

// ---- 恢复关键 GL 状态 ----
SMTool._restoreGL = function (gl, s) {
    gl.useProgram(s.prog);
    if (s.blend) { gl.enable(gl.BLEND); } else { gl.disable(gl.BLEND); }
    gl.blendFunc(s.blendSrc, s.blendDst);
    gl.activeTexture(s.activeTex);
    gl.bindTexture(gl.TEXTURE_2D, s.tex2D);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.arrBuf);
    gl.viewport(s.vp[0], s.vp[1], s.vp[2], s.vp[3]);
};

// ================================================================
// 渲染节点骨骼挂图（在共享画布上，跟随 Spine 骨骼动画）
// 调用时机：每帧每个节点骨架渲染完成后
// ================================================================
SMTool._renderNodeBoneImages = function (node, gl, nodeW, nodeH, sx, glY, sw, sh) {
    if (!node._boneScreenshots || !node.skeleton) return;
    var boneNames = Object.keys(node._boneScreenshots);
    if (boneNames.length === 0) return;

    // 懒初始化骨骼四边形渲染器（主画布共享）
    if (!SMTool._boneQR && gl) {
        SMTool._boneQR = SMTool._createBoneQuadRenderer(gl);
    }
    var qr = SMTool._boneQR;
    if (!qr) return;

    // ★ 显式恢复节点专属 viewport + scissor（4.x SceneRenderer.end() 可能重置）
    gl.viewport(sx, glY, sw, sh);
    gl.scissor(sx, glY, sw, sh);
    gl.enable(gl.SCISSOR_TEST);

    // 构建骨骼名 → 骨骼对象映射
    var bones = node.skeleton.bones;
    if (!bones || bones.length === 0) return;
    var boneMap = {};
    for (var i = 0; i < bones.length; i++) {
        var b = bones[i];
        var nm = (b.data && b.data.name) ? b.data.name : (typeof b.getName === 'function' ? b.getName() : '');
        if (nm) boneMap[nm] = b;
    }

    // 保存 GL 状态
    var saved = SMTool._saveGL(gl);

    // 设置骨骼挂图渲染管线
    gl.useProgram(qr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, qr.vbo);
    gl.enableVertexAttribArray(qr.aPos);
    gl.vertexAttribPointer(qr.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(qr.aUV);
    gl.vertexAttribPointer(qr.aUV, 2, gl.FLOAT, false, 16, 8);

    // 正交投影：映射节点画布坐标（Y-up，匹配 Spine 坐标系）
    var ortho = new Float32Array(16);
    SMTool._orthoM4(ortho, 0, nodeW, 0, nodeH, -1, 1);
    gl.uniform1i(qr.uTex, 0);

    var defSize = Math.max(Math.min(nodeH * 0.2, 250), 80); // 画布高度的 20%（80-250px）

    for (var bi = 0; bi < boneNames.length; bi++) {
        var boneName = boneNames[bi];
        var bone = boneMap[boneName];
        if (!bone) continue;

        var shotIds = node._boneScreenshots[boneName];
        if (!Array.isArray(shotIds)) shotIds = shotIds != null ? [shotIds] : [];
        if (shotIds.length === 0) continue;

        // 提取骨骼世界变换（兼容 3.8 / 4.x API）
        var bx, by, angle, scaleX, scaleY;
        if (typeof bone.getWorldX === 'function') {
            // 4.x: getWorldX/Y/RotationX/ScaleX
            bx = bone.getWorldX();
            by = bone.getWorldY();
            angle = (typeof bone.getWorldRotationX === 'function') ? bone.getWorldRotationX() : 0;
            scaleX = (typeof bone.getWorldScaleX === 'function') ? bone.getWorldScaleX() : 1;
            scaleY = (typeof bone.getWorldScaleY === 'function') ? bone.getWorldScaleY() : 1;
        } else {
            // 3.8: 直接属性访问
            bx = bone.worldX;
            by = bone.worldY;
            angle = Math.atan2(bone.b, bone.a);
            scaleX = Math.sqrt(bone.a * bone.a + bone.c * bone.c);
            scaleY = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
        }

        // 骨骼 worldX/Y 已含 skeleton x/y 偏移，无需额外加

        for (var si = 0; si < shotIds.length; si++) {
            var shotId = shotIds[si];
            if (typeof shotId !== 'number') continue;
            // ★ 检查挂载状态：false 则不渲染（性能优化）
            if (node._boneShotMounted && node._boneShotMounted[boneName] && node._boneShotMounted[boneName][si] === false) continue;

            var tex = SMTool._ensureBoneTexture(gl, shotId);
            if (!tex) continue;
            SMTool._uploadBoneTexture(gl, shotId);

            // 图片原始像素尺寸 = 100% 大小，骨骼 worldScale 跟随动画缩放
            var drawW = defSize, drawH = defSize;
            var entry = SMTool._boneTexCache[shotId];
            if (entry && entry.img && entry.img.width && entry.img.height) {
                drawW = entry.img.width;
                drawH = entry.img.height;
            }

            // 同一骨骼多张图微偏移，避免完全重叠
            var offX = si * 5;
            var offY = si * 5;

            var model = new Float32Array(16);
            SMTool._modelM4(model, bx + offX, by + offY, angle, drawW * scaleX, drawH * scaleY);

            var mvp = new Float32Array(16);
            SMTool._mulM4(mvp, ortho, model);
            gl.uniformMatrix4fv(qr.uMVP, false, mvp);
            gl.uniform1f(qr.uAlpha, 0.9);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    }

    // 恢复 GL 状态
    SMTool._restoreGL(gl, saved);
};

// ================================================================
// 渲染预览浮窗骨骼挂图（预览独立 WebGL 上下文）
// ================================================================
SMTool._renderPreviewBoneImages = function (pp) {
    if (!pp || !pp.visible || !pp.skeleton || !pp.gl) return;
    var nodeId = pp.nodeId;
    if (nodeId == null) return;
    var srcNode = SMData.nodes.get(nodeId);
    if (!srcNode || !srcNode._boneScreenshots) return;
    var boneNames = Object.keys(srcNode._boneScreenshots);
    if (boneNames.length === 0) return;

    var gl = pp.gl;
    var cw = pp._canvasWidth || (pp.canvas ? pp.canvas.width : 320);
    var ch = pp._canvasHeight || (pp.canvas ? pp.canvas.height : 500);

    // 懒初始化预览专属四边形渲染器
    if (!pp._boneQR) {
        pp._boneQR = SMTool._createBoneQuadRenderer(gl);
        pp._boneTexCache = {}; // 预览专属纹理缓存
    }
    var qr = pp._boneQR;
    if (!qr) return;

    // 构建骨骼映射
    var bones = pp.skeleton.bones;
    if (!bones || bones.length === 0) return;
    var boneMap = {};
    for (var i = 0; i < bones.length; i++) {
        var b = bones[i];
        var nm = (b.data && b.data.name) ? b.data.name : (typeof b.getName === 'function' ? b.getName() : '');
        if (nm) boneMap[nm] = b;
    }

    var saved = SMTool._saveGL(gl);

    gl.useProgram(qr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // ★ 显式恢复预览专属 viewport（4.x SceneRenderer.end() 可能重置）
    gl.viewport(0, 0, pp.canvas ? pp.canvas.width : cw, pp.canvas ? pp.canvas.height : ch);
    gl.bindBuffer(gl.ARRAY_BUFFER, qr.vbo);
    gl.enableVertexAttribArray(qr.aPos);
    gl.vertexAttribPointer(qr.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(qr.aUV);
    gl.vertexAttribPointer(qr.aUV, 2, gl.FLOAT, false, 16, 8);

    var ortho = new Float32Array(16);
    // ★ 预览缩放适配：正交投影范围与 Spine 预览渲染一致
    var zoom = pp._contentZoom || 1.0;
    var halfW = cw / (2 * zoom);
    var halfH = ch / (2 * zoom);
    SMTool._orthoM4(ortho, cw / 2 - halfW, cw / 2 + halfW, ch / 2 - halfH, ch / 2 + halfH, -1, 1);
    gl.uniform1i(qr.uTex, 0);

    var defSize = Math.max(Math.min((pp.canvas ? pp.canvas.height : ch) * 0.2, 250), 80); // 画布高度的 20%（80-250px）

    // 预览专属纹理辅助（复用主缓存的数据，但在预览 GL 上下文中创建纹理）
    function _ensurePreviewTex(shotId) {
        if (pp._boneTexCache[shotId]) return pp._boneTexCache[shotId].texture;
        var dataUrl = SMData._shotGetDataUrl ? SMData._shotGetDataUrl(shotId) : null;
        if (!dataUrl) return null;
        var img = new Image();
        img.src = dataUrl;
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        var entry = { texture: tex, img: img, uploaded: false };
        pp._boneTexCache[shotId] = entry;
        img.onload = function () { entry.uploaded = false; };
        return tex;
    }

    function _uploadPreviewTex(shotId) {
        var entry = pp._boneTexCache[shotId];
        if (!entry || entry.uploaded || !entry.img || !entry.img.complete || !entry.img.width) return;
        try {
            gl.bindTexture(gl.TEXTURE_2D, entry.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            entry.uploaded = true;
        } catch (e) {}
    }

    for (var bi = 0; bi < boneNames.length; bi++) {
        var boneName = boneNames[bi];
        var bone = boneMap[boneName];
        if (!bone) continue;

        var shotIds = srcNode._boneScreenshots[boneName];
        if (!Array.isArray(shotIds)) shotIds = shotIds != null ? [shotIds] : [];
        if (shotIds.length === 0) continue;

        var bx, by, angle, scaleX, scaleY;
        if (typeof bone.getWorldX === 'function') {
            bx = bone.getWorldX();
            by = bone.getWorldY();
            angle = (typeof bone.getWorldRotationX === 'function') ? bone.getWorldRotationX() : 0;
            scaleX = (typeof bone.getWorldScaleX === 'function') ? bone.getWorldScaleX() : 1;
            scaleY = (typeof bone.getWorldScaleY === 'function') ? bone.getWorldScaleY() : 1;
        } else {
            bx = bone.worldX;
            by = bone.worldY;
            angle = Math.atan2(bone.b, bone.a);
            scaleX = Math.sqrt(bone.a * bone.a + bone.c * bone.c);
            scaleY = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
        }
        // 骨骼 worldX/Y 已含 skeleton x/y 偏移，无需额外加

        for (var si = 0; si < shotIds.length; si++) {
            var shotId = shotIds[si];
            if (typeof shotId !== 'number') continue;

            var tex = _ensurePreviewTex(shotId);
            if (!tex) continue;
            _uploadPreviewTex(shotId);

            var drawW = defSize, drawH = defSize;
            var entry = pp._boneTexCache[shotId];
            if (entry && entry.img && entry.img.width && entry.img.height) {
                drawW = entry.img.width;
                drawH = entry.img.height;
            }

            var offX = si * 5;
            var offY = si * 5;

            var model = new Float32Array(16);
            SMTool._modelM4(model, bx + offX, by + offY, angle, drawW * scaleX, drawH * scaleY);

            var mvp = new Float32Array(16);
            SMTool._mulM4(mvp, ortho, model);
            gl.uniformMatrix4fv(qr.uMVP, false, mvp);
            gl.uniform1f(qr.uAlpha, 0.9);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    }

    SMTool._restoreGL(gl, saved);
};
