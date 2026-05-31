/* ================================================================
   Spine 文件加载 & 解析
   负责: 拖拽文件的读取、Spine 版本检测、atlas 解析、skeleton 解析
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 辅助函数 ----
SMTool._esc = function (s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
};

SMTool._uint8ToBase64 = function (uint8) {
    var binary = '';
    for (var i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    return btoa(binary);
};

SMTool._base64ToUint8 = function (base64) {
    var binary = atob(base64);
    var uint8 = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) uint8[i] = binary.charCodeAt(i);
    return uint8;
};

// ---- 从拖拽文件创建节点 ----
SMTool._onDrop = function (e) {
    var files = Array.from(e.dataTransfer.files);
    console.log('[Drop] Files:', files.map(function (f) { return f.name; }).join(', '));

    // 以鼠标松手位置为基准
    var dropX = e.clientX;
    var dropY = e.clientY;

    var groups = {};
    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var base = f.name;
        var exts = ['.json', '.skel', '.atlas', '.png', '.jpg', '.jpeg'];
        for (var j = 0; j < exts.length; j++) {
            if (base.toLowerCase().endsWith(exts[j])) {
                base = base.slice(0, -exts[j].length);
                break;
            }
        }
        if (!groups[base]) groups[base] = {};
        groups[base][f.name.split('.').pop().toLowerCase()] = f;
    }

    var keys = Object.keys(groups);
    // 计算累计水平偏移，防止多个文件组的节点重叠
    var accumulatedOffset = 0;
    var H_SPACING = 350; // 每个文件组之间的水平间距（屏幕像素）
    for (var k = 0; k < keys.length; k++) {
        var base = keys[k];
        var group = groups[base];
        if (group.json || group.skel) {
            SMTool._createNode(group, base, dropX + accumulatedOffset, dropY);
            accumulatedOffset += H_SPACING;
        }
    }
};

// ---- 创建节点（多动画自动拆分） ----
// optX, optY: 可选的屏幕坐标（拖放时传入鼠标松手位置）
SMTool._createNode = function (fileGroup, baseName, optX, optY) {
    var id = SMData.nextId++;
    var node = new SpineNodeData(id);
    node.name = baseName;
    node.sourceFile = baseName;

    var sx = (optX !== undefined) ? optX : (SMData._mx || window.innerWidth / 2);
    var sy = (optY !== undefined) ? optY : (SMData._my || window.innerHeight / 2);
    var wp = SMTool.canvasToWorld(sx, sy);
    node.x = wp.x;
    node.y = wp.y;
    SMData.nodes.set(id, node);

    SMTool._createEl(node);
    SMTool._updatePos(node);

    var self = this;
    SMTool._loadSpine(node, fileGroup).then(function () {
        var anims = node.animations;
        var animNames = [];
        for (var ai = 0; ai < anims.length; ai++) animNames.push(anims[ai].name);
        // 异步联网翻译
        SMTool._translateAnimNames(animNames, function () {});
        if (anims.length > 0) {
            node.name = SMTool._translateName(anims[0].name);
            SMTool._updateEl(node);
        }
        if (anims.length > 1) {
            var allNodes = [node]; // 收集所有节点用于布局
            var animIdx = 1;

            // 串行创建克隆（逐个来，避免真实浏览器中并发 WebGL 上下文竞争导致首个节点画面丢失）
            function createNextClone() {
                if (animIdx >= anims.length) {
                    // 全部完成，自动布局并全选所有衍生节点
                    setTimeout(function () {
                        SMTool._autoLayoutNodes(allNodes, node.x, node.y);
                        // 全选这批文件产生的所有节点
                        SMData.selectedNodes.clear();
                        for (var si = 0; si < allNodes.length; si++) {
                            SMData.selectedNodes.add(allNodes[si].id);
                        }
                        SMData.selectedNode = allNodes[0].id;
                        SMTool._updateSel();
                        SMTool._updateSB();
                    }, 200);
                    return;
                }
                SMTool._createCloneNode(node, anims[animIdx].name, animIdx, anims.length, function (clonedNode) {
                    if (clonedNode) allNodes.push(clonedNode);
                    animIdx++;
                    // 加短暂延迟让浏览器消化当前 WebGL 上下文
                    setTimeout(createNextClone, 80);
                });
            }
            createNextClone();
        } else {
            if (SMData.nodes.size <= 1) setTimeout(function () { SMTool.fitAll(); }, 300);
        }
        SMTool._updateSB();
    }).catch(function (err) {
        console.error('[Spine] Load failed:', err);
        node.name = baseName + ' (加载失败)';
        SMTool._updateEl(node);
    });

    SMTool._updateSB();
    SMTool._updateSel();
};

// ---- 自动布局：间距 = 每个节点自身面板宽度 / 2，每行最多5个，左到右上到下排列 ----
// anchorWorldX, anchorWorldY: 可选的世界坐标锚点（拖放时传入鼠标松手位置），
//   第一个节点固定在该锚点，其余节点以此为基础向右/下排列
SMTool._autoLayoutNodes = function (nodesArray, anchorWorldX, anchorWorldY) {
    if (!nodesArray.length) return;

    var maxCols = 5;  // 每行最多5个
    var hasAnchor = (anchorWorldX !== undefined && anchorWorldY !== undefined);

    // 读取每个节点的屏幕尺寸，并计算每个节点的自身间距 = 面板宽度 / 2
    var sizes = [];
    for (var i = 0; i < nodesArray.length; i++) {
        var el = SMTool._getEl(nodesArray[i].id);
        var w, h;
        if (el) {
            var rect = el.getBoundingClientRect();
            w = rect.width;
            h = rect.height;
        } else {
            w = nodesArray[i].width || 300;
            h = (nodesArray[i]._canvasHeight || 400) + 100;
        }
        var spacing = Math.max(50, Math.round(w / 2));  // 自身四周间距 = 面板宽度 / 2，最小50px
        sizes.push({ node: nodesArray[i], w: w, h: h, spacing: spacing });
    }

    // 逐行计算列宽和行高
    var rows = [];      // [{ nodes: [...], maxH: number, maxSpacing: number }]
    var curRow = { nodes: [], maxH: 0, maxSpacing: 0 };
    for (var i = 0; i < sizes.length; i++) {
        if (curRow.nodes.length >= maxCols) {
            rows.push(curRow);
            curRow = { nodes: [], maxH: 0, maxSpacing: 0 };
        }
        curRow.nodes.push(sizes[i]);
        curRow.maxH = Math.max(curRow.maxH, sizes[i].h);
        curRow.maxSpacing = Math.max(curRow.maxSpacing, sizes[i].spacing);
    }
    if (curRow.nodes.length > 0) rows.push(curRow);

    // 计算起始屏幕坐标
    var startScreenX, startScreenY;
    if (hasAnchor) {
        // 将世界坐标锚点转换回屏幕坐标，作为布局起点
        var sp = SMTool.worldToCanvas(anchorWorldX, anchorWorldY);
        startScreenX = sp.x;
        startScreenY = sp.y;
    } else {
        startScreenX = sizes[0].spacing;
        startScreenY = sizes[0].spacing;
    }

    // 从左到右、从上到下放置
    var y = startScreenY;
    for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var x = startScreenX;
        for (var c = 0; c < row.nodes.length; c++) {
            var s = row.nodes[c];
            var wp = SMTool.canvasToWorld(x, y);
            s.node.x = wp.x;
            s.node.y = wp.y;
            SMTool._updatePos(s.node);
            // 当前节点右边的间距 = 当前节点自身 spacing
            x += s.w + s.spacing;
        }
        // 行间距取当前行和下一行的最大 spacing 中的较大值
        var rowGap = row.maxSpacing;
        if (r + 1 < rows.length) {
            rowGap = Math.max(row.maxSpacing, rows[r + 1].maxSpacing);
        }
        y += row.maxH + rowGap;
    }

    // 适配视图
    setTimeout(function () { SMTool.fitAll(); }, 100);
    setTimeout(function () { SMTool._updateDuplicateHighlights(); }, 200);
    setTimeout(function () { SMTool._checkMissingStates(); }, 200);
    SMTool._refreshAllTranslations();
};

// ---- 从已加载节点克隆出新节点（每个动画一个节点） ----
SMTool._createCloneNode = function (sourceNode, animName, index, total, callback) {
    var id = SMData.nextId++;
    var node = new SpineNodeData(id);
    node.name = SMTool._translateName(animName);
    node.sourceFile = sourceNode.sourceFile;

    // 先用临时位置（自动布局会重新计算）
    node.x = sourceNode.x;
    node.y = sourceNode.y;

    // 复制源数据
    node._srcSkelJson = sourceNode._srcSkelJson;
    node._srcSkelBinBase64 = sourceNode._srcSkelBinBase64;
    node._srcAtlasText = sourceNode._srcAtlasText;
    node._srcTexDataUrl = sourceNode._srcTexDataUrl;
    node._srcType = sourceNode._srcType;
    node._srcFileNames = sourceNode._srcFileNames ? sourceNode._srcFileNames.slice() : [];
    node.currentAnim = animName;
    node.animations = sourceNode.animations.slice();
    node.skins = sourceNode.skins.slice();
    node.slots = sourceNode.slots.slice();
    node.bones = sourceNode.bones.slice();
    node.version = sourceNode.version;

    SMData.nodes.set(id, node);
    SMTool._createEl(node);
    SMTool._updatePos(node);

    SMTool._loadFromSourceData(node).then(function () {
        SMTool._updateEl(node);
        setTimeout(function () { SMTool._updateStateRowColors(); }, 150);
        SMTool._updateDuplicateHighlights();
        SMTool._checkMissingStates();
        SMTool._refreshAllTranslations();
        if (callback) callback(node);
    }).catch(function (err) {
        console.error('[Clone] Failed to restore rendering for "' + animName + '":', err);
        node.name = animName + ' (失败)';
        SMTool._updateEl(node);
        if (callback) callback(node);
    });
};

// ---- 节点内拖入替换 Spine 文件 ----
SMTool._onND = function (e, nid) {
    e.preventDefault();
    e.stopPropagation();

    var files = Array.from(e.dataTransfer.files);
    if (!files.length) return;

    var groups = {};
    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var base = f.name;
        var exts = ['.json', '.skel', '.atlas', '.png', '.jpg', '.jpeg'];
        for (var j = 0; j < exts.length; j++) {
            if (base.toLowerCase().endsWith(exts[j])) {
                base = base.slice(0, -exts[j].length);
                break;
            }
        }
        if (!groups[base]) groups[base] = {};
        groups[base][f.name.split('.').pop().toLowerCase()] = f;
    }

    var node = SMData.nodes.get(nid);
    if (!node) return;

    var keys = Object.keys(groups);
    for (var k = 0; k < keys.length; k++) {
        var g = groups[keys[k]];
        SMTool._loadSpine(node, g).then(function () {
            SMTool._updateEl(node);
        }).catch(function (err) {
            console.error('[NodeDrop] Failed:', err);
        });
        break;
    }
};

// ---- 读取文件内容 ----
SMTool._readFile = function (file) {
    return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onerror = function () {
            reject(new Error('Cannot read ' + file.name));
        };

        var ext = file.name.split('.').pop().toLowerCase();

        if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
            r.onload = function () {
                resolve({ t: 'img', d: r.result, n: file.name });
            };
            r.readAsDataURL(file);
        } else if (ext === 'skel') {
            r.onload = function () {
                resolve({ t: 'bin', d: new Uint8Array(r.result), n: file.name });
            };
            r.readAsArrayBuffer(file);
        } else if (ext === 'json') {
            r.onload = function () {
                var buf = new Uint8Array(r.result);
                var i = 0;
                // 跳过 UTF-8 BOM
                if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) i = 3;
                while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0A || buf[i] === 0x0D)) i++;
                if (i < buf.length && (buf[i] === 0x7B || buf[i] === 0x5B)) {
                    // 文本 JSON
                    var txt = new TextDecoder('utf-8').decode(buf);
                    resolve({ t: 'txt', d: txt, n: file.name });
                } else {
                    // 二进制 .skel 被误命名为 .json
                    console.log('[Spine]   ' + file.name + ' has .json extension but binary content → treating as .skel');
                    resolve({ t: 'bin', d: buf, n: file.name });
                }
            };
            r.readAsArrayBuffer(file);
        } else {
            r.onload = function () {
                resolve({ t: 'txt', d: r.result, n: file.name });
            };
            r.readAsText(file);
        }
    });
};

// ---- 主要的 Spine 加载逻辑 ----
SMTool._loadSpine = function (node, fileGroup) {
    return new Promise(function (resolve, reject) {
        console.log('[Spine] Loading "' + node.name + '"...', Object.keys(fileGroup));

        // 第一步：读取所有文件
        var readPromises = [];
        var fileKeys = Object.keys(fileGroup);
        for (var i = 0; i < fileKeys.length; i++) {
            readPromises.push(SMTool._readFile(fileGroup[fileKeys[i]]));
        }

        Promise.all(readPromises).then(function (results) {
            console.log('[Spine] Read:', results.map(function (r) { return r.t + ':' + r.n; }).join(', '));

            // 第二步：分类文件内容
            var atlasText = '', pngUrl = '', skelBin = null, skelJson = null;

            for (var i = 0; i < results.length; i++) {
                var r = results[i];
                if (r.t === 'txt') {
                    var s = r.d;
                    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); // 去 BOM
                    try {
                        var j = JSON.parse(s);
                        if (j.bones || j.slots || j.skins || j.animations || j.events ||
                            (j.skeleton && (typeof j.skeleton === 'object') &&
                                (j.bones !== undefined || j.slots !== undefined || j.skins !== undefined || j.animations !== undefined))) {
                            skelJson = j;
                        } else {
                            console.warn('[Spine] ⚠ JSON parsed but NOT a Spine skeleton. Keys:', Object.keys(j).join(', '));
                        }
                    } catch (e) {
                        if (!atlasText) atlasText = r.d;
                    }
                } else if (r.t === 'img') {
                    pngUrl = r.d;
                } else if (r.t === 'bin') {
                    skelBin = r.d;
                }
            }

            if (!pngUrl) return reject(new Error('No PNG found'));
            if (!atlasText) return reject(new Error('No .atlas found'));
            if (!skelJson && !skelBin) return reject(new Error('No skeleton (.json/.skel) found'));

            // 第三步：检测 Spine 版本
            var detectedVersion = '';
            if (skelJson) {
                detectedVersion = (skelJson.skeleton && skelJson.skeleton.spine) || '';
            } else if (skelBin) {
                detectedVersion = SMTool._detectBinaryVersion(skelBin);
            }
            console.log('[Spine] Detected version: "' + detectedVersion + '"');

            var atlasIs4x = /^pma\s*:/m.test(atlasText);

            // 第四步：确定运行时版本
            var useVer = SMTool._resolveRuntimeVersion(detectedVersion, skelBin, atlasIs4x);
            var SP = SMTool._getSpineRuntime(useVer);
            var WGL = useVer === '3.8' ? (window.spine38 && window.spine38.webgl) : null;

            if (!SP) return reject(new Error('No spine runtime available for ' + useVer));
            console.log('[Spine] Using runtime: spine-webgl ' + useVer);

            node._spineVer = useVer;
            node._SP = SP;
            node._physParam = (useVer !== '3.8' && SP.Physics) ? SP.Physics.update : undefined;

            // 3.8 兼容：去除 4.x atlas 的 pma 行
            if (useVer === '3.8' && atlasIs4x) {
                console.log('[Spine]   Atlas has 4.x format (pma:), stripping for 3.8 compat');
                atlasText = atlasText.replace(/^pma\s*:.*$/gm, '').replace(/\n{2,}/g, '\n');
            }

            // 第五步：存储原始数据用于导出 + 记录源文件名
            node._srcSkelJson = skelJson;
            node._srcSkelBinBase64 = skelBin ? SMTool._uint8ToBase64(skelBin) : null;
            node._srcAtlasText = atlasText;
            node._srcTexDataUrl = pngUrl;
            node._srcType = skelBin ? 'skel' : 'json';
            // 收集原始文件名（含后缀）
            node._srcFileNames = [];
            for (var ri = 0; ri < results.length; ri++) {
                if (results[ri].n) node._srcFileNames.push(results[ri].n);
            }

            // 第六步：加载图片
            var img = new Image();
            img.onload = function () {
                console.log('[Spine] Image: ' + img.width + 'x' + img.height);
                node.textureImg = img;
                SMTool._parseSpineData(node, SP, WGL, atlasText, pngUrl, skelJson, skelBin, img, useVer)
                    .then(resolve).catch(reject);
            };
            img.onerror = function () {
                reject(new Error('PNG load failed'));
            };
            img.src = pngUrl;
        }).catch(reject);
    });
};

// ---- 检测二进制 skeleton 版本 ----
SMTool._detectBinaryVersion = function (skelBin) {
    try {
        var SP43 = window.spine43;
        if (SP43 && SP43.BinaryInput) {
            try {
                var input = new SP43.BinaryInput(skelBin);
                input.readInt32();
                input.readInt32();
                return input.readString() || '';
            } catch (e) { /* 尝试 3.8 格式 */ }
        }
        var SP38 = window.spine38;
        if (SP38 && SP38.BinaryInput) {
            try {
                var input38 = new SP38.BinaryInput(new DataView(skelBin.buffer));
                var v = '' + (input38.readString() || '') + '|' + (input38.readString() || '');
                return v.replace(/^[^|]*\|/, '');
            } catch (e2) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }
    return '';
};

// ---- 确定运行时版本 ----
SMTool._resolveRuntimeVersion = function (detectedVersion, skelBin, atlasIs4x) {
    if (detectedVersion && detectedVersion.match(/^4\.[3-9]/)) return '4.3';
    if (detectedVersion && detectedVersion.match(/^4\.[012]\./)) return '4.2';
    if (detectedVersion && detectedVersion.match(/^3\.\d/)) return '3.8';
    if (!detectedVersion) {
        if (skelBin) return '4.3';
        if (atlasIs4x) return '4.3';
    }
    return '3.8';
};

// ---- 获取对应的 Spine 运行时 ----
SMTool._getSpineRuntime = function (useVer) {
    if (useVer === '4.3') return window.spine43;
    if (useVer === '4.2') return window.spine42;
    return window.spine38;
};

// ---- 解析 Spine 数据 ----
SMTool._parseSpineData = function (node, SP, WGL, atlasText, pngUrl, skelJson, skelBin, img, useVer) {
    return new Promise(function (resolve, reject) {
        try {
            // 创建 Atlas
            var atlas;
            if (useVer === '4.3' || useVer === '4.2') {
                atlas = new SP.TextureAtlas(atlasText);
            } else {
                atlas = new SP.TextureAtlas(atlasText, function () {
                    return new SP.FakeTexture(img);
                });
            }
            node.atlasData = atlas;
            console.log('[Spine] Atlas: ' + atlas.pages.length + ' page(s), ' + atlas.regions.length + ' region(s)');

            // 加载 SkeletonData
            var al = new SP.AtlasAttachmentLoader(atlas);
            var sd;
            if (skelBin) {
                console.log('[Spine] Parsing .skel (' + skelBin.length + ' bytes)');
                var bl = new SP.SkeletonBinary(al);
                bl.scale = 1;
                sd = bl.readSkeletonData(skelBin);
            } else {
                var jl = new SP.SkeletonJson(al);
                jl.scale = 1;
                sd = jl.readSkeletonData(skelJson);
            }

            node.skeletonData = sd;
            node.version = sd.version || '';
            console.log('[Spine] Skeleton v' + node.version + ': ' + sd.bones.length + ' bones');

            // 提取动画/皮肤/插槽/骨骼信息
            node.animations = [];
            for (var ai = 0; ai < sd.animations.length; ai++) {
                node.animations.push({ name: sd.animations[ai].name, duration: sd.animations[ai].duration });
            }
            node.skins = [];
            for (var si = 0; si < sd.skins.length; si++) {
                node.skins.push(sd.skins[si].name);
            }
            node.slots = [];
            for (var sli = 0; sli < sd.slots.length; sli++) {
                node.slots.push(sd.slots[sli].name);
            }
            node.bones = [];
            for (var bi = 0; bi < sd.bones.length; bi++) {
                node.bones.push(sd.bones[bi].name);
            }

            // 创建 Skeleton 实例
            var sk = new SP.Skeleton(sd);
            if (sd.defaultSkin) sk.setSkin(sd.defaultSkin);
            sk.setToSetupPose();
            if (atlas.pages.length > 0 && (atlas.pages[0].pma || atlas.pages[0].premultipliedAlpha)) {
                node.premultipliedAlpha = true;
            }
            node.skeleton = sk;

            // 创建 AnimationState
            var stateData = new SP.AnimationStateData(sd);
            var state = new SP.AnimationState(stateData);
            node.state = state;
            if (node.animations.length > 0) {
                state.setAnimation(0, node.animations[0].name, true);
                node.currentAnim = node.animations[0].name;
            }

            // 委托给渲染模块设置 WebGL
            if (SMTool._setupWebGLRenderer) {
                SMTool._setupWebGLRenderer(node, SP, WGL, atlas, img, useVer);
            }

            SMTool._updateEl(node);
            setTimeout(function () { SMTool._updateStateRowColors(); }, 100);

            resolve();
        } catch (e) {
            reject(new Error('Skeleton parse failed (' + useVer + '): ' + e.message));
        }
    });
};

// ---- 手动计算骨骼边界 ----
SMTool._computeBoundsManually = function (skeleton, offset, size) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var drawOrder = skeleton.drawOrder;
    if (!drawOrder || !Array.isArray(drawOrder)) {
        offset.set(0, 0);
        size.set(100, 100);
        return;
    }
    var verts = [];
    for (var i = 0; i < drawOrder.length; i++) {
        var slot = drawOrder[i];
        if (!slot || !slot.bone || !slot.bone.active) continue;
        var att;
        try { att = slot.getAttachment(); } catch (e) { att = slot.attachment; }
        if (!att || typeof att.computeWorldVertices !== 'function') continue;
        var vc;
        if (att.worldVerticesLength) {
            vc = att.worldVerticesLength;
        } else if (att.uvs && att.uvs.length >= 8) {
            vc = 8;
        } else {
            continue;
        }
        if (verts.length < vc) verts.length = vc;
        try {
            att.computeWorldVertices(slot, 0, vc, verts, 0, 2);
            for (var j = 0; j < vc; j += 2) {
                minX = Math.min(minX, verts[j]);
                maxX = Math.max(maxX, verts[j]);
                minY = Math.min(minY, verts[j + 1]);
                maxY = Math.max(maxY, verts[j + 1]);
            }
        } catch (e) { /* skip */ }
    }
    if (!isFinite(minX)) { offset.set(0, 0); size.set(100, 100); return; }
    offset.set(minX, minY);
    size.set(maxX - minX, maxY - minY);
};

// ---- 从已存储的源数据恢复 WebGL 渲染 ----
SMTool._loadFromSourceData = function (node) {
    return new Promise(function (resolve, reject) {
        var ver = node.version || '';
        var useVer = SMTool._resolveRuntimeVersion(ver, null, false);
        var SP = SMTool._getSpineRuntime(useVer);
        var WGL = useVer === '3.8' ? (window.spine38 && window.spine38.webgl) : null;

        node._spineVer = useVer;
        node._SP = SP;
        node._physParam = (useVer !== '3.8' && SP.Physics) ? SP.Physics.update : undefined;

        if (!SP) return reject(new Error('No spine runtime available'));

        var atlasText = node._srcAtlasText;
        var texDataUrl = node._srcTexDataUrl;
        var srcType = node._srcType || 'json';

        console.log('[Import] Restoring "' + node.name + '" from ' + srcType + ' source');

        var img = new Image();
        img.onload = function () {
            try {
                var atlas;
                if (useVer === '4.3' || useVer === '4.2') {
                    atlas = new SP.TextureAtlas(atlasText);
                } else {
                    atlas = new SP.TextureAtlas(atlasText, function () { return new SP.FakeTexture(img); });
                }
                node.atlasData = atlas;
                node.textureImg = img;

                var al = new SP.AtlasAttachmentLoader(atlas);
                var sd;
                if (srcType === 'skel' && node._srcSkelBinBase64) {
                    var skelBin = SMTool._base64ToUint8(node._srcSkelBinBase64);
                    var bl = new SP.SkeletonBinary(al); bl.scale = 1;
                    sd = bl.readSkeletonData(skelBin);
                } else {
                    if (!node._srcSkelJson) return reject(new Error('No skeleton JSON data'));
                    var jl = new SP.SkeletonJson(al); jl.scale = 1;
                    sd = jl.readSkeletonData(node._srcSkelJson);
                }

                node.skeletonData = sd;
                node.version = sd.version || node.version;
                node.bones = [];
                for (var i = 0; i < sd.bones.length; i++) node.bones.push(sd.bones[i].name);

                var sk = new SP.Skeleton(sd);
                if (sd.defaultSkin) sk.setSkin(sd.defaultSkin);
                sk.setToSetupPose();
                if (atlas.pages.length > 0 && atlas.pages[0].pma) node.premultipliedAlpha = true;
                node.skeleton = sk;

                var stateData = new SP.AnimationStateData(sd);
                var state = new SP.AnimationState(stateData);
                node.state = state;
                if (node.animations.length > 0) {
                    var animName = node.currentAnim || node.animations[0].name;
                    state.setAnimation(0, animName, true);
                    node.currentAnim = animName;
                }

                if (SMTool._setupWebGLRenderer) {
                    SMTool._setupWebGLRenderer(node, SP, WGL, atlas, img, useVer);
                }
                resolve();
            } catch (e) {
                reject(e);
            }
        };
        img.onerror = function () { reject(new Error('Texture image load failed')); };
        img.src = texDataUrl;
    });
};

// ---- 本地离线翻译词典（游戏动画常用词） ----
var ANIM_TRANS_DICT = {
    // 基础动作
    'idle': '待机', 'idle1': '待机1', 'idle2': '待机2', 'idle3': '待机3',
    'walk': '行走', 'walk1': '行走1', 'walk2': '行走2',
    'run': '奔跑', 'run1': '奔跑1', 'run2': '奔跑2',
    'jump': '跳跃', 'jump1': '跳跃1', 'jump2': '跳跃2',
    'attack': '攻击', 'attack1': '攻击1', 'attack2': '攻击2', 'attack3': '攻击3', 'attack4': '攻击4',
    'atk': '攻击', 'atk1': '攻击1', 'atk2': '攻击2', 'atk2b': '攻击2b', 'atk2c': '攻击2c', 'atk3': '攻击3', 'atk4': '攻击4',
    'skill': '技能', 'skill1': '技能1', 'skill2': '技能2', 'skill3': '技能3',
    'hit': '受击', 'hit1': '受击1', 'hit2': '受击2',
    'hurt': '受伤', 'death': '死亡', 'dead': '死亡',
    'die': '死亡', 'dying': '濒死',
    'win': '胜利', 'victory': '胜利', 'lose': '失败', 'defeat': '失败',
    'cheer': '欢呼', 'dance': '舞蹈',
    'enter': '入场', 'enter1': '入场1', 'enter2': '入场2',
    'appear': '出场', 'disappear': '消失',
    'sit': '坐下', 'sleep': '睡眠', 'wake': '醒来',
    'stand': '站立', 'crouch': '蹲下', 'kneel': '跪下',
    'fly': '飞行', 'float': '漂浮', 'swim': '游泳',
    'cast': '施法', 'magic': '魔法', 'spell': '咒语',
    'defend': '防御', 'guard': '格挡', 'block': '格挡',
    'dodge': '闪避', 'roll': '翻滚',
    'shoot': '射击', 'bow': '弓箭', 'arrow': '射箭',
    'throw': '投掷', 'catch': '接住',
    'pickup': '拾取', 'drop': '放下',
    'open': '打开', 'close': '关闭',
    'push': '推', 'pull': '拉',
    'climb': '攀爬', 'fall': '坠落',
    'land': '着陆', 'takeoff': '起飞',
    'turn': '转身', 'rotate': '旋转',
    'stun': '眩晕', 'freeze': '冻结', 'burn': '燃烧',
    'buff': '增益', 'debuff': '减益', 'heal': '治疗',
    'taunt': '嘲讽', 'laugh': '大笑', 'cry': '哭泣',
    'talk': '说话', 'greet': '问候', 'wave': '挥手',
    'pose': '姿势', 'pose1': '姿势1', 'pose2': '姿势2',
    'special': '特殊', 'special1': '特殊1', 'special2': '特殊2',
    'ultimate': '大招', 'ult': '大招',
    // 带前缀的常见命名
    'h_idle': '待机', 'h_idle1': '待机1', 'h_idle2': '待机2',
    'h_walk': '行走', 'h_run': '奔跑',
    'h_attack': '攻击', 'h_atk': '攻击',
    'hidle': '待机', 'hidle1': '待机1',
    'hwalk': '行走', 'hrun': '奔跑',
    'hatk': '攻击', 'hatk1': '攻击1',
    'move': '移动', 'moving': '移动中',
    'damage': '受伤', 'damaged': '受伤',
    'charged': '蓄力', 'charge': '蓄力',
    'charging': '蓄力中',
    'chuxian': '出现', 'xiaoshi': '消失',
    'pifeng': '披风', 'weapon': '武器',
    'shadow': '影子', 'body': '身体',
    'head': '头部', 'hand': '手部', 'lhand': '左手', 'rhand': '右手',
    'shoulder': '肩膀', 'lshoulder': '左肩', 'rshoulder': '右肩',
    'xiuzi': '袖子', 'gebo': '胳膊',
    'normal': '普通', 'default': '默认',
    'loop': '循环', 'once': '单次',
    'start': '开始', 'end': '结束', 'intro': '开场',
    'outro': '结尾', 'ending': '结局',
    // 复合词常见组成部分
    'state': '状态', 'loop': '循环', 'start': '开始', 'end': '结束',
    'front': '前', 'back': '后', 'left': '左', 'right': '右',
    'up': '上', 'down': '下', 'in': '入', 'out': '出',
    'fast': '快速', 'slow': '慢速', 'long': '长', 'short': '短',
    'big': '大', 'small': '小', 'high': '高', 'low': '低',
    'normal': '普通', 'special': '特殊', 'extra': '额外',
    'combo': '连击', 'chain': '连锁', 'burst': '爆发',
    'fire': '火', 'ice': '冰', 'wind': '风', 'light': '光', 'dark': '暗',
    'thunder': '雷', 'water': '水', 'earth': '土', 'poison': '毒',
    'sword': '剑', 'blade': '刃', 'gun': '枪', 'staff': '杖',
    'ready': '准备', 'active': '激活', 'passive': '被动',
    'half': '半', 'full': '满', 'empty': '空'
};

// ---- 拼音→中文映射（游戏动画常见拼音命名） ----
var PINYIN_DICT = {
    'chuxian': '出现', 'xiaoshi': '消失', 'dengdai': '等待',
    'gongji': '攻击', 'fangyu': '防御', 'shandian': '闪电',
    'tiaoyue': '跳跃', 'xingzou': '行走', 'benpao': '奔跑',
    'siwang': '死亡', 'shoushang': '受伤', 'shengli': '胜利',
    'shibai': '失败', 'xuanzhuan': '旋转', 'feixing': '飞行',
    'xuji': '蓄力', 'jineng': '技能', 'dazhao': '大招',
    'jiangluo': '降落', 'rusheng': '上升', 'duobi': '躲避',
    'zhanli': '站立', 'dunxia': '蹲下', 'paqi': '爬起',
    'rushui': '入水', 'chushui': '出水', 'zhuolu': '着陆',
    'qifei': '起飞', 'huanhu': '欢呼', 'tiaowu': '舞蹈',
    'shuijiao': '睡觉', 'xinglai': '醒来', 'bingsi': '濒死',
    'shifa': '施法', 'zhiliao': '治疗', 'dongjie': '冻结',
    'ranshao': '燃烧', 'xuanyun': '眩晕', 'zengyi': '增益',
    'jianyi': '减益', 'shanbi': '闪避', 'fangun': '翻滚',
    'toushi': '投掷', 'sheji': '射击', 'pandeng': '攀爬',
    'zhuiluo': '坠落', 'shiqu': '拾取', 'kaiqi': '开启',
    'guanbi': '关闭', 'chuchang': '出场', 'ruchang': '入场',
    'putong': '普通', 'teshu': '特殊', 'xunhuan': '循环',
    'danqu': '单次', 'kaichang': '开场', 'jieju': '结局',
    'zhunbei': '准备', 'jihuo': '激活', 'beidong': '被动'
};

// ---- 编辑距离（Levenshtein）模糊匹配 ----
function _levDist(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    var m = [], i, j;
    for (i = 0; i <= a.length; i++) { m[i] = [i]; }
    for (j = 0; j <= b.length; j++) { m[0][j] = j; }
    for (i = 1; i <= a.length; i++) {
        for (j = 1; j <= b.length; j++) {
            m[i][j] = Math.min(
                m[i-1][j] + 1,
                m[i][j-1] + 1,
                m[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)
            );
        }
    }
    return m[a.length][b.length];
}

function _fuzzyMatch(word, dict, maxDist) {
    maxDist = maxDist || 2;
    var best = null, bestDist = maxDist + 1;
    var keys = Object.keys(dict);
    for (var i = 0; i < keys.length; i++) {
        var d = _levDist(word, keys[i]);
        if (d < bestDist) { bestDist = d; best = keys[i]; }
    }
    return bestDist <= maxDist ? dict[best] : null;
}

// ---- 判断是否像拼音（全小写字母，无空格数字，长度≤10） ----
function _looksLikePinyin(word) {
    return /^[a-z]{3,10}$/.test(word) && !/[aeiou]{3,}/.test(word);
}

// ---- 联网翻译（Google 免费接口） ----
SMTool._translateAnimNames = function (names, callback) {
    if (!names || !names.length) { callback({}); return; }
    var uncached = [];
    for (var i = 0; i < names.length; i++) {
        if (!SMData._transCache[names[i]]) uncached.push(names[i]);
    }
    if (!uncached.length) { callback(SMData._transCache); return; }

    var joined = uncached.join('\n');
    var url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' + encodeURIComponent(joined);
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 5000;
    xhr.onload = function () {
        if (xhr.status === 200) {
            try {
                var data = JSON.parse(xhr.responseText);
                if (data && data[0]) {
                    var lines = [];
                    for (var j = 0; j < data[0].length; j++) {
                        if (data[0][j] && data[0][j][0]) lines.push(data[0][j][0].trim());
                    }
                    for (var k = 0; k < uncached.length; k++) {
                        SMData._transCache[uncached[k]] = lines[k] || uncached[k];
                    }
                }
            } catch (e) { console.warn('[Translate] Parse error:', e.message); }
        }
        callback(SMData._transCache);
    };
    xhr.onerror = function () { callback(SMData._transCache); };
    xhr.ontimeout = function () { callback(SMData._transCache); };
    xhr.send();
};

// ---- 全局刷新所有节点翻译（延迟1s保底） ----
SMTool._refreshAllTranslations = function () {
    setTimeout(function () {
        var allNames = new Set();
        var nodesIter = SMData.nodes.values();
        var r = nodesIter.next();
        while (!r.done) {
            if (r.value.currentAnim) allNames.add(r.value.currentAnim);
            r = nodesIter.next();
        }
        var nameArr = [];
        var setIter = allNames.values();
        var si = setIter.next();
        while (!si.done) { nameArr.push(si.value); si = setIter.next(); }
        if (!nameArr.length) return;

        SMTool._translateAnimNames(nameArr, function () {
            var nodesIter2 = SMData.nodes.values();
            var r2 = nodesIter2.next();
            while (!r2.done) {
                var n = r2.value;
                if (n.currentAnim) {
                    var cn = SMData._transCache[n.currentAnim] || n.currentAnim;
                    if (n.name !== cn) { n.name = cn; SMTool._updateEl(n); }
                }
                r2 = nodesIter2.next();
            }
        });
    }, 1000);
};

// ---- 查找翻译（缓存优先） ----
SMTool._translateName = function (name) {
    return SMData._transCache[name] || name;
};
