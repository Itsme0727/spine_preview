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

// 安全转义字符串，用于嵌入 HTML onclick 属性中的 JS 字符串字面量
// 上下文: onclick="...SMTool.foo(123,'VALUE','bar')"
// 需同时处理 HTML 属性定界符(")和 JS 字符串定界符(')
SMTool._escAttr = function (s) {
    return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
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
    if (files.length !== 1) { SMTool._onDropSpineFiles(files, e.clientX, e.clientY); return; }
    var f = files[0];

    // ★ 彻底 dump File 对象所有属性
    console.log('[Drop] === 文件属性 dump ===');
    console.log('[Drop] name:', f.name, 'size:', f.size, 'type:', f.type);
    console.log('[Drop] .path:', f.path, 'type:', typeof f.path);
    console.log('[Drop] .webkitRelativePath:', f.webkitRelativePath);
    // 枚举所有自有属性
    var ownKeys = Object.getOwnPropertyNames(f);
    console.log('[Drop] ownPropertyNames:', ownKeys);
    // 也检查 __proto__ 上的
    try {
        var protoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(f));
        console.log('[Drop] proto keys:', protoKeys.slice(0, 30));
    } catch (ex) {}
    console.log('[Drop] ====================');

    if (!f.name.toLowerCase().endsWith('.json')) { SMTool._onDropSpineFiles(files, e.clientX, e.clientY); return; }

    var reader = new FileReader();
    var item = (e.dataTransfer.items && e.dataTransfer.items[0]) || null;

    // ---- 解析目录（3 种方式，统一返回 string 路径 或 handle 对象） ----
    var dirPromise = Promise.resolve(null);

    // 方式 A：File.path（Electron 专有）
    if (typeof f.path === 'string' && f.path.length > 0) {
        var dp = f.path.replace(/\\/g, '/').replace(/\/[^\/]*$/, '');
        console.log('[Drop] ✅ A-File.path:', dp);
        dirPromise = Promise.resolve({ type: 'path', value: dp });
    }
    // 方式 B：getAsFileSystemHandle + getParent
    else if (item && typeof item.getAsFileSystemHandle === 'function') {
        dirPromise = item.getAsFileSystemHandle().then(function (h) {
            if (h && h.getParent) {
                return h.getParent().then(function (p) {
                    console.log('[Drop] ✅ B-getParent');
                    return { type: 'handle', value: p };
                }).catch(function () { return null; });
            }
            // 至少保存 fileHandle 用于覆写 JSON
            if (h) SMData._dragSaveHandle = h;
            return null;
        }).catch(function () { return null; });
    }
    // 方式 C：webkitGetAsEntry + getParent
    else if (item && typeof item.webkitGetAsEntry === 'function') {
        dirPromise = new Promise(function (resolve) {
            var entry = item.webkitGetAsEntry();
            if (entry && entry.isFile && entry.getParent) {
                entry.getParent(
                    function (p) { console.log('[Drop] ✅ C-webkitGetAsEntry'); resolve({ type: 'entry', value: p }); },
                    function () { resolve(null); }
                );
            } else { resolve(null); }
        });
    }

    reader.onload = function () {
        try {
            var data = JSON.parse(reader.result);
            if (!data || (!data.nodes && !data.connections && !data.view)) {
                SMTool._onDropSpineFiles(files, e.clientX, e.clientY); return;
            }
        } catch (ex) {
            SMTool._onDropSpineFiles(files, e.clientX, e.clientY); return;
        }

        console.log('[Drop] 识别为项目文件');
        dirPromise.then(function (dr) {
            if (dr) {
                if (dr.type === 'handle') { SMData._assetsDirHandle = dr.value; console.log('[Drop] → _assetsDirHandle'); }
                else if (dr.type === 'entry') { SMData._legacyDirEntry = dr.value; console.log('[Drop] → _legacyDirEntry'); }
                else if (dr.type === 'path') { SMData._dropDirPath = dr.value; console.log('[Drop] → _dropDirPath'); }
            } else {
                console.log('[Drop] ⚠️ 无任何目录获取方式成功');
            }
            return SMTool._processImportJson(reader.result, null);
        }).then(function () {
            return SMTool._tryLoadCompanionImages();
        }).then(function () {
            SMTool._updateFloatPanel();
            SMTool._showSaveToast('导入完成');
        }).catch(function (err) {
            console.error('[Drop] 导入失败:', err);
        });
    };
    reader.onerror = function () { SMTool._onDropSpineFiles(files, e.clientX, e.clientY); };
    reader.readAsText(f);
};

// ---- 原有 Spine 文件拖放逻辑（提取为独立函数）----
SMTool._onDropSpineFiles = function (files, dropX, dropY) {

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
        var ext = f.name.split('.').pop().toLowerCase();
        // 多图集支持：PNG 文件用 _pngs 数组存储，避免同名扩展覆盖
        if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
            if (!groups[base]._pngs) groups[base]._pngs = [];
            groups[base]._pngs.push(f);
            if (!groups[base].png) groups[base].png = f; // 第一个作为默认
        } else {
            groups[base][ext] = f;
        }
    }

    // 合并孤儿 PNG 组：如果某组只有图片没有骨架，尝试合并到前缀匹配的父组
    var keys = Object.keys(groups);
    for (var k = 0; k < keys.length; k++) {
        var base = keys[k];
        var group = groups[base];
        if (!group.json && !group.skel && !group.atlas && group._pngs) {
            // 寻找父组：其 base 是当前 base 的前缀
            for (var m = 0; m < keys.length; m++) {
                var parentBase = keys[m];
                if (parentBase === base) continue;
                var parentGroup = groups[parentBase];
                if ((parentGroup.json || parentGroup.skel || parentGroup.atlas) &&
                    base.indexOf(parentBase) === 0 && base.length > parentBase.length) {
                    // 合并 PNG 到父组
                    if (!parentGroup._pngs) parentGroup._pngs = [];
                    for (var pi = 0; pi < group._pngs.length; pi++) {
                        parentGroup._pngs.push(group._pngs[pi]);
                    }
                    console.log('[Drop] Merged orphan PNGs of "' + base + '" into parent "' + parentBase + '"');
                    group._merged = true;
                    break;
                }
            }
        }
    }

    // 计算累计水平偏移，防止多个文件组的节点重叠
    var accumulatedOffset = 0;
    var H_SPACING = 350; // 每个文件组之间的水平间距（屏幕像素）
    for (var k2 = 0; k2 < keys.length; k2++) {
        var base2 = keys[k2];
        var group2 = groups[base2];
        if (group2._merged) continue; // 跳过已合并的孤儿组
        if (group2.json || group2.skel) {
            SMTool._createNode(group2, base2, dropX + accumulatedOffset, dropY);
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
    node._srcTexDataUrls = sourceNode._srcTexDataUrls ? sourceNode._srcTexDataUrls.slice() : [];
    node._srcType = sourceNode._srcType;
    node._srcFileNames = sourceNode._srcFileNames ? sourceNode._srcFileNames.slice() : [];
    node.currentAnim = animName;
    node.currentSkin = sourceNode.currentSkin;
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
        var ext = f.name.split('.').pop().toLowerCase();
        // 多图集支持：PNG 文件用 _pngs 数组存储
        if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') {
            if (!groups[base]._pngs) groups[base]._pngs = [];
            groups[base]._pngs.push(f);
            if (!groups[base].png) groups[base].png = f;
        } else {
            groups[base][ext] = f;
        }
    }

    // 合并孤儿 PNG 组到父组
    var keys = Object.keys(groups);
    for (var k = 0; k < keys.length; k++) {
        var base = keys[k];
        var group = groups[base];
        if (!group.json && !group.skel && !group.atlas && group._pngs) {
            for (var m = 0; m < keys.length; m++) {
                var parentBase = keys[m];
                if (parentBase === base) continue;
                var parentGroup = groups[parentBase];
                if ((parentGroup.json || parentGroup.skel || parentGroup.atlas) &&
                    base.indexOf(parentBase) === 0 && base.length > parentBase.length) {
                    if (!parentGroup._pngs) parentGroup._pngs = [];
                    for (var pi = 0; pi < group._pngs.length; pi++) {
                        parentGroup._pngs.push(group._pngs[pi]);
                    }
                    group._merged = true;
                    break;
                }
            }
        }
    }

    var node = SMData.nodes.get(nid);
    if (!node) return;

    for (var k2 = 0; k2 < keys.length; k2++) {
        var g = groups[keys[k2]];
        if (g._merged) continue;
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

// ---- 从 atlas 文本中提取所有页面的图片文件名 ----
// 返回数组 [{ name: 'page1.png' }, ...]，仅提取文件名（不含路径）
SMTool._extractAtlasPageNames = function (atlasText) {
    var names = [];
    var lines = atlasText.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        // 页面行：非空、不以冒号结尾（不是 key: value）、包含 .png/.jpg/.jpeg
        if (line && line.indexOf(':') === -1 && /\.(png|jpg|jpeg)$/i.test(line)) {
            // 提取纯文件名（去掉路径）
            var name = line.replace(/\\/g, '/').split('/').pop();
            // 去重
            var dup = false;
            for (var d = 0; d < names.length; d++) {
                if (names[d].name === name) { dup = true; break; }
            }
            if (!dup) names.push({ name: name });
        }
    }
    return names;
};

// ---- 主要的 Spine 加载逻辑 ----
SMTool._loadSpine = function (node, fileGroup) {
    return new Promise(function (resolve, reject) {
        console.log('[Spine] Loading "' + node.name + '"...', Object.keys(fileGroup));

        // 第一步：读取所有文件（包括 _pngs 数组中的多张图片）
        var readPromises = [];
        var fileKeys = Object.keys(fileGroup);
        var pngFiles = fileGroup._pngs || [];
        if (fileGroup.png && pngFiles.length === 0) pngFiles = [fileGroup.png];
        // 用 Set 记录已读文件名，避免重复读取
        var readNames = {};
        for (var pi = 0; pi < pngFiles.length; pi++) {
            readNames[pngFiles[pi].name.toLowerCase()] = true;
            readPromises.push(SMTool._readFile(pngFiles[pi]));
        }
        for (var i = 0; i < fileKeys.length; i++) {
            var k = fileKeys[i];
            if (k === '_pngs' || k === '_merged' || k === 'png') continue; // 跳过辅助字段和已读 PNG
            var f = fileGroup[k];
            if (!readNames[f.name.toLowerCase()]) {
                readPromises.push(SMTool._readFile(f));
            }
        }

        Promise.all(readPromises).then(function (results) {
            console.log('[Spine] Read:', results.map(function (r) { return r.t + ':' + r.n; }).join(', '));

            // 第二步：分类文件内容
            var atlasText = '', skelBin = null, skelJson = null;
            // 多图集：收集所有图片 { 文件名(小写): dataUrl }
            var imgMap = {};

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
                    imgMap[r.n.toLowerCase()] = r.d;
                } else if (r.t === 'bin') {
                    skelBin = r.d;
                }
            }

            var imgNames = Object.keys(imgMap);
            if (imgNames.length === 0) return reject(new Error('No PNG found'));
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

            // 第五步：匹配 atlas 页面到图片
            var atlasPageNames = SMTool._extractAtlasPageNames(atlasText);
            console.log('[Spine] Atlas pages:', atlasPageNames.map(function (p) { return p.name; }).join(', '));
            console.log('[Spine] Available PNGs:', imgNames.join(', '));

            // 为每个 atlas 页面找到匹配的图片 dataUrl
            var pageDataUrls = []; // [{ name, dataUrl }]
            for (var ai = 0; ai < atlasPageNames.length; ai++) {
                var pageName = atlasPageNames[ai].name;
                var pageNameLower = pageName.toLowerCase();
                var foundUrl = imgMap[pageNameLower];
                if (!foundUrl) {
                    // 模糊匹配：查找包含 pageName 的图片文件
                    for (var mi = 0; mi < imgNames.length; mi++) {
                        if (imgNames[mi].indexOf(pageNameLower) !== -1 ||
                            pageNameLower.indexOf(imgNames[mi]) !== -1) {
                            foundUrl = imgMap[imgNames[mi]];
                            console.log('[Spine]   Fuzzy match: "' + pageName + '" → "' + imgNames[mi] + '"');
                            break;
                        }
                    }
                }
                if (foundUrl) {
                    pageDataUrls.push({ name: pageName, dataUrl: foundUrl });
                } else {
                    console.warn('[Spine]   ⚠ No PNG found for atlas page: "' + pageName + '"');
                    // 回退：使用第一个可用的图片
                    if (imgNames.length > 0) {
                        pageDataUrls.push({ name: pageName, dataUrl: imgMap[imgNames[0]] });
                    }
                }
            }

            // 如果 atlas 没有显式页面名（罕见），直接用第一个图片
            if (pageDataUrls.length === 0 && imgNames.length > 0) {
                pageDataUrls.push({ name: imgNames[0], dataUrl: imgMap[imgNames[0]] });
            }

            // 首选 pngUrl（向后兼容：第一页）
            var pngUrl = pageDataUrls.length > 0 ? pageDataUrls[0].dataUrl : '';

            // 第六步：存储原始数据
            node._srcSkelJson = skelJson;
            node._srcSkelBinBase64 = skelBin ? SMTool._uint8ToBase64(skelBin) : null;
            node._srcAtlasText = atlasText;
            node._srcTexDataUrl = pngUrl;
            node._srcTexDataUrls = pageDataUrls;
            node._srcType = skelBin ? 'skel' : 'json';
            // 收集原始文件名（含后缀）
            node._srcFileNames = [];
            for (var ri = 0; ri < results.length; ri++) {
                if (results[ri].n) node._srcFileNames.push(results[ri].n);
            }

            // 第七步：加载所有图片（并行），按页面顺序
            var imgs = [];
            var loadedCount = 0;
            var totalPages = pageDataUrls.length;

            if (totalPages === 0) {
                return reject(new Error('No texture pages to load'));
            }

            for (var pi2 = 0; pi2 < totalPages; pi2++) {
                (function (idx) {
                    var img = new Image();
                    img.onload = function () {
                        console.log('[Spine] Image[' + idx + '] ' + pageDataUrls[idx].name + ': ' + img.width + 'x' + img.height);
                        imgs[idx] = img;
                        loadedCount++;
                        if (loadedCount >= totalPages) {
                            // 全部加载完成
                            node.textureImg = imgs[0];
                            node._texImgs = imgs;
                            SMTool._parseSpineData(node, SP, WGL, atlasText, pageDataUrls, skelJson, skelBin, imgs, useVer)
                                .then(resolve).catch(reject);
                        }
                    };
                    img.onerror = function () {
                        console.warn('[Spine] ⚠ Failed to load image: ' + pageDataUrls[idx].name);
                        imgs[idx] = null;
                        loadedCount++;
                        if (loadedCount >= totalPages) {
                            node.textureImg = imgs[0];
                            node._texImgs = imgs;
                            SMTool._parseSpineData(node, SP, WGL, atlasText, pageDataUrls, skelJson, skelBin, imgs, useVer)
                                .then(resolve).catch(reject);
                        }
                    };
                    img.src = pageDataUrls[idx].dataUrl;
                })(pi2);
            }
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
        // ★ 二进制文件检测失败：尝试用首字节判断 3.x vs 4.x
        //    3.x 格式首字节是 hash 长度（0x00-0x64），4.x 首字节是版本字符串
        if (skelBin && skelBin.length > 0) {
            var firstByte = skelBin[0];
            // 3.x 格式：第一个字节是 0-100 之间的 hash 长度
            if (firstByte >= 1 && firstByte <= 64) return '3.8';
            // 4.x 格式：第一个字节是 ASCII 数字/字母
            if (firstByte >= 0x30 && firstByte <= 0x7A) return '4.3';
        }
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
// imgs: 按 atlas page 索引的 Image 数组，pageDataUrls: [{ name, dataUrl }]
SMTool._parseSpineData = function (node, SP, WGL, atlasText, pageDataUrls, skelJson, skelBin, imgs, useVer) {
    return new Promise(function (resolve, reject) {
        try {
            var firstImg = (imgs && imgs.length > 0) ? imgs[0] : null;
            // 创建 Atlas
            var atlas;
            if (useVer === '4.3' || useVer === '4.2') {
                atlas = new SP.TextureAtlas(atlasText);
            } else {
                // 3.8: 为每个页面返回对应图片的 FakeTexture（多图集支持）
                atlas = new SP.TextureAtlas(atlasText, function (pagePath) {
                    var pathStr = (typeof pagePath === 'string') ? pagePath : (pagePath && pagePath.name ? pagePath.name : '');
                    var pageFileName = pathStr.replace(/\\/g, '/').split('/').pop().toLowerCase();
                    var matchImg = firstImg;
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
            console.log('[Spine] Skeleton v' + node.version + ': ' + sd.bones.length + ' bones, ' + sd.slots.length + ' slots, ' + sd.skins.length + ' skins, ' + sd.animations.length + ' anims');

            // ★ 诊断：输出附件类型统计
            try {
                var attStats = {};
                for (var ski = 0; ski < sd.skins.length; ski++) {
                    var skinAtts = sd.skins[ski].attachments;
                    if (!skinAtts) continue;
                    for (var slotI = 0; slotI < skinAtts.length; slotI++) {
                        var atts = skinAtts[slotI];
                        if (!atts) continue;
                        for (var attI = 0; attI < atts.length; attI++) {
                            var att = atts[attI];
                            if (!att) continue;
                            var typeName = att.constructor ? att.constructor.name : (att.type || 'unknown');
                            attStats[typeName] = (attStats[typeName] || 0) + 1;
                        }
                    }
                }
                console.log('[Spine] Attachment types:', JSON.stringify(attStats));
            } catch (e3) { console.log('[Spine] Attachment stats error:', e3); }

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
            node.currentSkin = (sd.defaultSkin && sd.defaultSkin.name) || '';
            sk.setToSetupPose();
            if (atlas.pages.length > 0 && (atlas.pages[0].pma || atlas.pages[0].premultipliedAlpha)) {
                node.premultipliedAlpha = true;
            }
            node.skeleton = sk;

            // 创建 AnimationState
            var stateData = new SP.AnimationStateData(sd);
            var state = new SP.AnimationState(stateData);
            node.state = state;

            // 初始化/补全默认轨道（_createEl 可能已提前创建了空轨道）
            if (!node.tracks || node.tracks.length === 0) {
                node.tracks = [{
                    animName: (node.animations[0] && node.animations[0].name) || '',
                    alpha: 1.0,
                    mixBlend: 'replace',
                    enabled: true,
                    loop: true,
                    mixDuration: 0
                }];
                node.currentAnim = node.tracks[0].animName;
            } else if (!node.tracks[0].animName && node.animations.length > 0) {
                // _createEl 阶段已创建空轨道，补全真实动画名
                node.tracks[0].animName = node.animations[0].name;
                node.currentAnim = node.animations[0].name;
            }
            // 应用轨道配置到 AnimationState
            SMTool._applyTracksToState(node);

            // 委托给渲染模块设置 WebGL
            if (SMTool._setupWebGLRenderer) {
                SMTool._setupWebGLRenderer(node, SP, WGL, atlas, imgs, useVer);
            }

            // ★ _setupWebGLRenderer 内部调用了 sk.setToSetupPose()，重置了骨架姿势。
            // 必须在此重新应用动画状态，否则缩小画布时（perf 模式跳过 update/apply）会显示绑定姿势贴图
            if (node.state && node.skeleton) {
                node.state.update(0);
                node.state.apply(node.skeleton);
                // ★ 防御：修复 skeleton 根位置 NaN（空默认皮肤文件可能出现）
                if (isNaN(node.skeleton.x)) node.skeleton.x = 0;
                if (isNaN(node.skeleton.y)) node.skeleton.y = 0;
                node.skeleton.updateWorldTransform(node._physParam);
                // ★ 动画后再算一次边界，把骨架居中到画布（空默认皮肤文件 setup pose 无边）
                SMTool._centerSkeletonAfterAnim(node);
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
        // worldVerticesLength 返回浮点数数量（每个顶点 2 个浮点数: x, y）
        // uvs 数组同样每个顶点 2 个浮点数: u, v
        // computeWorldVertices 第3参数 count 需要的是顶点数量（非浮点数）
        var floatCount;
        if (att.worldVerticesLength) {
            floatCount = att.worldVerticesLength;
        } else if (att.uvs && att.uvs.length >= 8) {
            floatCount = att.uvs.length;
        } else {
            continue;
        }
        var vertexCount = floatCount / 2;
        if (verts.length < floatCount) verts.length = floatCount;
        try {
            att.computeWorldVertices(slot, 0, vertexCount, verts, 0, 2);
            for (var j = 0; j < floatCount; j += 2) {
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

// ---- 动画后处理：画布自适应扩展（v8：参照浮窗预览，有效 setup 皮肤免采样）----
// 骨架居中由 _setupWebGLRenderer 的 setup pose 边界完成，稳定可靠。
// 仅对空默认皮肤文件（setup 无边）做动画采样 + 画布扩展。
// 有皮肤文件：setup 画布已有充足 padding，不再重复处理。
SMTool._centerSkeletonAfterAnim = function (node) {
    var sk = node.skeleton;
    var SP = node._SP || window.spine38;
    if (!sk || !SP) return;

    // ★ 参照浮窗预览：有效 setup bounds → 不采样动画、不修改骨架
    var bo = node.bounds && node.bounds.offset;
    var bs = node.bounds && node.bounds.size;
    var setupValid = bo && bs && isFinite(bo.x) && bs.x > 0;
    if (setupValid) return;

    // ====== 以下仅对空默认皮肤文件执行 ======
    var cw = node._canvasWidth || 400;
    var ch = node._canvasHeight || 400;

    try {
        var sd = node.skeletonData;
        if (!sd) return;

        var global = SMTool._getSourceGlobalBounds(node, SP, sd);
        if (!global) return;

        var padX = Math.max(60, Math.ceil(global.w * 0.15));
        var padY = Math.max(60, Math.ceil(global.h * 0.15));
        var neededW = Math.max(400, Math.ceil(global.w) + padX * 2);
        var neededH = Math.max(400, Math.ceil(global.h) + padY * 2);
        neededW = Math.max(neededW, cw);
        neededH = Math.max(neededH, ch);
        if (neededW > cw || neededH > ch) {
            console.log('[Center] Auto-expand for #' + node.id +
                ': ' + cw + 'x' + ch + ' → ' + neededW + 'x' + neededH +
                ' (global: ' + global.w.toFixed(0) + 'x' + global.h.toFixed(0) + ')');
            SMTool._resolveSourceCanvasSize(node, neededW, neededH, cw, ch);
            // 画布扩展后用全局中心重新居中
            cw = node._canvasWidth;
            ch = node._canvasHeight;
            sk.x = cw / 2 - global.cx;
            sk.y = ch / 2 - global.cy;
            node._baseSkX = sk.x;
            node._baseSkY = sk.y;
        }

    } catch (e) {
        console.warn('[Center] Failed for #' + node.id + ': ' + e.message);
    }
    // ★ 确保动画状态正确（参照浮窗预览：重置 trackTime=0 + apply）
    try {
        var e0 = node.state && node.state.getCurrent(0);
        if (e0) { e0.trackTime = 0; }
        node.state.apply(sk);
    } catch (e2) {}
    sk.updateWorldTransform(node._physParam);
};

// ★ 画布自适应扩展（独立于居中逻辑）
SMTool._autoExpandCanvas = function (node, SP, sd, curCw, curCh) {
    try {
        var global = SMTool._getSourceGlobalBounds(node, SP, sd);
        if (!global) return;
        var padX = Math.max(60, Math.ceil(global.w * 0.15));
        var padY = Math.max(60, Math.ceil(global.h * 0.15));
        var neededW = Math.max(400, Math.ceil(global.w) + padX * 2);
        var neededH = Math.max(400, Math.ceil(global.h) + padY * 2);
        neededW = Math.max(neededW, curCw);
        neededH = Math.max(neededH, curCh);
        if (neededW > curCw || neededH > curCh) {
            console.log('[Center] Auto-expand for #' + node.id +
                ': ' + curCw + 'x' + curCh + ' → ' + neededW + 'x' + neededH +
                ' (global: ' + global.w.toFixed(0) + 'x' + global.h.toFixed(0) + ')');
            SMTool._resolveSourceCanvasSize(node, neededW, neededH, curCw, curCh);
        }
    } catch (e) {
        console.warn('[Center] Auto-expand failed for #' + node.id + ': ' + e.message);
    }
};

// ★ 全局动画范围缓存（key: sourceFile）→ { w, h, cx, cy }
SMTool._sourceGlobalBoundsCache = {};

// 获取某源文件全部动画的全局最大包围盒及几何中心（带缓存）
// ★ 保存并恢复骨架状态，不干扰调用方
SMTool._getSourceGlobalBounds = function (node, SP, sd) {
    var key = node.sourceFile;
    if (!key) return null;
    if (SMTool._sourceGlobalBoundsCache[key]) return SMTool._sourceGlobalBoundsCache[key];

    var allAnims = sd.animations || sd._animations || [];
    if (allAnims.length === 0) return null;

    var sk = node.skeleton;
    var savedX = sk.x, savedY = sk.y;
    sk.x = 0; sk.y = 0; sk.updateWorldTransform(node._physParam);

    var gMinX = Infinity, gMinY = Infinity, gMaxX = -Infinity, gMaxY = -Infinity;
    var tmpStateData = new SP.AnimationStateData(sd);
    var tmpState = new SP.AnimationState(tmpStateData);
    var tmpOff = new SP.Vector2();
    var tmpSize = new SP.Vector2();

    var maxAnims = Math.min(allAnims.length, 20);
    for (var ai = 0; ai < maxAnims; ai++) {
        var animName = allAnims[ai].name;
        if (!animName) continue;
        var tmpEntry = tmpState.setAnimation(0, animName, true);
        if (!tmpEntry) continue;
        var dur = (tmpEntry.animation && tmpEntry.animation.duration) ||
                  (tmpEntry._animation && tmpEntry._animation.duration);
        if (!dur || dur <= 0) dur = 1;
        var samples = Math.min(8, Math.max(4, Math.ceil(dur * 6)));
        for (var s = 0; s < samples; s++) {
            var t = (s / samples) * dur;
            tmpEntry.trackTime = t;
            tmpState.update(0);
            tmpState.apply(sk);
            sk.updateWorldTransform(node._physParam);
            if (typeof sk.getBounds === 'function') {
                sk.getBounds(tmpOff, tmpSize, []);
            } else {
                SMTool._computeBoundsManually(sk, tmpOff, tmpSize);
            }
            if (isFinite(tmpOff.x) && isFinite(tmpSize.x) && tmpSize.x > 0) {
                gMinX = Math.min(gMinX, tmpOff.x);
                gMinY = Math.min(gMinY, tmpOff.y);
                gMaxX = Math.max(gMaxX, tmpOff.x + tmpSize.x);
                gMaxY = Math.max(gMaxY, tmpOff.y + tmpSize.y);
            }
        }
        tmpState.clearTracks();
    }

    // ★ 恢复骨架
    sk.x = savedX; sk.y = savedY;
    node.state.apply(sk);
    sk.updateWorldTransform(node._physParam);

    if (!isFinite(gMinX)) return null;
    var result = {
        w: gMaxX - gMinX,
        h: gMaxY - gMinY,
        cx: (gMinX + gMaxX) / 2,  // ★ 全局包围盒几何中心
        cy: (gMinY + gMaxY) / 2
    };
    SMTool._sourceGlobalBoundsCache[key] = result;
    return result;
};

// ★ 解析同源节点的最终画布尺寸（取最大值并同步）
SMTool._resolveSourceCanvasSize = function (node, neededW, neededH, curCw, curCh) {
    // 收集所有同源节点已有的画布尺寸
    var maxW = Math.max(neededW, curCw);
    var maxH = Math.max(neededH, curCh);
    if (node.sourceFile) {
        var nodesIter = SMData.nodes.values();
        var r = nodesIter.next();
        while (!r.done) {
            var n = r.value;
            if (n.sourceFile === node.sourceFile && n.id !== node.id) {
                var nw = n._debugCanvasW || n._canvasWidth || 400;
                var nh = n._debugCanvasH || n._canvasHeight || 400;
                if (nw > maxW) maxW = nw;
                if (nh > maxH) maxH = nh;
            }
            r = nodesIter.next();
        }
    }
    if (maxW > curCw || maxH > curCh) {
        SMTool._syncCanvasSizeToSource(node.sourceFile, maxW, maxH);
    }
};

// ★ v3：统一同源节点的画布尺寸（并修正已居中骨架的位置）
SMTool._syncCanvasSizeToSource = function (sourceFile, cw, ch) {
    if (!sourceFile) return;
    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        var n = r.value;
        if (n.sourceFile === sourceFile) {
            var oldCw = n._canvasWidth || 400;
            var oldCh = n._canvasHeight || 400;
            var changed = false;
            if (n._canvasWidth !== cw) { n._canvasWidth = cw - 4; changed = true; }
            if (n._canvasHeight !== ch) { n._canvasHeight = ch; changed = true; }
            n.width = Math.max(cw, n.width, 260);
            if (changed) {
                // ★ 修正已居中骨架的位置：保持 avgCX/avgCY 不变，重新映射到新画布中心
                if (n.skeleton && n._baseSkX !== undefined) {
                    var avgCX = oldCw / 2 - n._baseSkX;
                    var avgCY = oldCh / 2 - n._baseSkY;
                    n.skeleton.x = cw / 2 - avgCX;
                    n.skeleton.y = ch / 2 - avgCY;
                    n._baseSkX = n.skeleton.x;
                    n._baseSkY = n.skeleton.y;
                    n.skeleton.updateWorldTransform(n._physParam);
                }
            }
            // ★ 始终同步 DOM 尺寸（即使 _canvasWidth 未变，style.width 可能被 _setupWebGLRenderer 覆盖过）
            var nEl = SMTool._getEl(n.id);
            if (nEl) {
                // 节点有 border: 2px 左右各 2px，内容宽度 = 总宽 - 4px
                if (nEl.style.width !== (n.width - 4) + 'px') nEl.style.width = (n.width - 4) + 'px';
                var nWrap = nEl.querySelector('.spine-canvas-wrap');
                if (nWrap) {
                    if (nWrap.style.width !== (cw - 8) + 'px') nWrap.style.width = (cw - 8) + 'px';
                    if (nWrap.style.height !== ch + 'px') nWrap.style.height = ch + 'px';
                    var nPh = nWrap.querySelector('div');
                    if (nPh) {
                        if (nPh.style.width !== cw + 'px') nPh.style.width = cw + 'px';
                        if (nPh.style.height !== ch + 'px') nPh.style.height = ch + 'px';
                    }
                }
            }
        }
        r = nodesIter.next();
    }
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
        var srcType = node._srcType || 'json';
        // 多图集支持：优先使用 _srcTexDataUrls，回退到单个 _srcTexDataUrl
        var pageDataUrls = (node._srcTexDataUrls && node._srcTexDataUrls.length > 0)
            ? node._srcTexDataUrls
            : [{ name: 'texture', dataUrl: node._srcTexDataUrl }];

        console.log('[Import] Restoring "' + node.name + '" from ' + srcType + ' source, ' + pageDataUrls.length + ' page(s)');

        // 加载所有图片（并行）
        var imgs = [];
        var loadedCount = 0;
        var totalPages = pageDataUrls.length;

        if (totalPages === 0) return reject(new Error('No texture data'));

        for (var pi = 0; pi < totalPages; pi++) {
            (function (idx) {
                var img = new Image();
                img.onload = function () {
                    imgs[idx] = img;
                    loadedCount++;
                    if (loadedCount >= totalPages) finishLoad();
                };
                img.onerror = function () {
                    console.warn('[Import] ⚠ Failed to load image ' + idx);
                    imgs[idx] = null;
                    loadedCount++;
                    if (loadedCount >= totalPages) finishLoad();
                };
                img.src = pageDataUrls[idx].dataUrl;
            })(pi);
        }

        function finishLoad() {
            try {
                var firstImg = imgs[0];
                var atlas;
                if (useVer === '4.3' || useVer === '4.2') {
                    atlas = new SP.TextureAtlas(atlasText);
                } else {
                    // 3.8: 多图集支持，为每个页面匹配对应图片
                    atlas = new SP.TextureAtlas(atlasText, function (pagePath) {
                        var pathStr = (typeof pagePath === 'string') ? pagePath : (pagePath && pagePath.name ? pagePath.name : '');
                        var pageFileName = pathStr.replace(/\\/g, '/').split('/').pop().toLowerCase();
                        var matchImg = firstImg;
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
                node.atlasData = atlas;
                node.textureImg = firstImg;
                node._texImgs = imgs;

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
                // ★ 补充填充动画/皮肤/插槽列表
                node.animations = [];
                for (var ai = 0; ai < sd.animations.length; ai++) {
                    node.animations.push({ name: sd.animations[ai].name, duration: sd.animations[ai].duration || 0 });
                }
                node.skins = [];
                for (var si = 0; si < sd.skins.length; si++) node.skins.push(sd.skins[si].name);
                node.slots = [];
                for (var sli = 0; sli < sd.slots.length; sli++) node.slots.push(sd.slots[sli].name);

                var sk = new SP.Skeleton(sd);
                if (sd.defaultSkin) sk.setSkin(sd.defaultSkin);
                node.currentSkin = (sd.defaultSkin && sd.defaultSkin.name) || '';
                sk.setToSetupPose();
                if (atlas.pages.length > 0 && atlas.pages[0].pma) node.premultipliedAlpha = true;
                node.skeleton = sk;

                var stateData = new SP.AnimationStateData(sd);
                var state = new SP.AnimationState(stateData);
                node.state = state;

                // 初始化/补全默认轨道（_createEl 可能已提前创建了空轨道）
                if (!node.tracks || node.tracks.length === 0) {
                    var defaultAnim = node.currentAnim || (node.animations[0] && node.animations[0].name) || '';
                    node.tracks = [{
                        animName: defaultAnim,
                        alpha: 1.0,
                        mixBlend: 'replace',
                        enabled: true,
                        loop: node.loop !== false,
                        mixDuration: 0
                    }];
                } else if (!node.tracks[0].animName && node.animations.length > 0) {
                    // _createEl 阶段已创建空轨道，补全真实动画名
                    var fillAnim = node.currentAnim || node.animations[0].name;
                    node.tracks[0].animName = fillAnim;
                    node.currentAnim = fillAnim;
                } else if (node.currentAnim && node.tracks[0].animName !== node.currentAnim) {
                    // ★ 克隆节点：轨道动画名与当前动画不一致时，纠正为当前动画
                    var animExists2 = false;
                    for (var ai2 = 0; ai2 < node.animations.length; ai2++) {
                        if (node.animations[ai2].name === node.currentAnim) { animExists2 = true; break; }
                    }
                    if (animExists2) {
                        node.tracks[0].animName = node.currentAnim;
                    }
                }
                // 应用轨道配置到 AnimationState
                SMTool._applyTracksToState(node);

                if (SMTool._setupWebGLRenderer) {
                    SMTool._setupWebGLRenderer(node, SP, WGL, atlas, imgs, useVer);
                }
                // ★ 重新应用动画状态（_setupWebGLRenderer 的 setToSetupPose 会重置骨架）
                if (node.state && node.skeleton) {
                    node.state.update(0);
                    node.state.apply(node.skeleton);
                    // ★ 防御：修复 skeleton 根位置 NaN
                    if (isNaN(node.skeleton.x)) node.skeleton.x = 0;
                    if (isNaN(node.skeleton.y)) node.skeleton.y = 0;
                    node.skeleton.updateWorldTransform(node._physParam);
                    // ★ 动画后再算一次边界，把骨架居中
                    SMTool._centerSkeletonAfterAnim(node);
                }
                resolve();
            } catch (e) {
                reject(e);
            }
        }
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
// 将下划线分隔的名字拆成段，每段单独翻译后再用 _ 拼接
// 例如 "walk_left" → 拆为 ["walk","left"] → 分别翻译 → "步行_左"
SMTool._translateAnimNames = function (names, callback) {
    if (!names || !names.length) { callback({}); return; }

    // 1. 过滤未缓存的名字
    var uncached = [];
    for (var i = 0; i < names.length; i++) {
        if (!SMData._transCache[names[i]]) uncached.push(names[i]);
    }
    if (!uncached.length) { callback(SMData._transCache); return; }

    // 2. 按 _ 拆分段，构建 段→索引 的去重映射，以及 原名→段索引列表 的关系
    var allSegments = [];            // 所有唯一段（按首次出现顺序）
    var segIndexMap = {};            // "segment" → 在 allSegments 中的索引
    var nameSegIndices = {};         // "原名" → [segIdx1, segIdx2, ...]

    for (var n = 0; n < uncached.length; n++) {
        var origName = uncached[n];
        var parts = origName.split('_');
        var indices = [];
        for (var p = 0; p < parts.length; p++) {
            var seg = parts[p];
            if (!seg) continue; // 跳过空段（连续下划线产生）
            if (segIndexMap[seg] === undefined) {
                segIndexMap[seg] = allSegments.length;
                allSegments.push(seg);
            }
            indices.push(segIndexMap[seg]);
        }
        nameSegIndices[origName] = indices;
    }

    if (!allSegments.length) { callback(SMData._transCache); return; }

    // 3. 将所有唯一段用换行拼接，一次性发给 Google
    var joined = allSegments.join('\n');
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

                    // 4. 对每个原始名，取出对应段的翻译结果，用 _ 按顺序拼回去
                    for (var k = 0; k < uncached.length; k++) {
                        var origName = uncached[k];
                        var indices = nameSegIndices[origName];
                        var translatedParts = [];
                        for (var pi = 0; pi < indices.length; pi++) {
                            var segIdx = indices[pi];
                            translatedParts.push(lines[segIdx] || allSegments[segIdx]);
                        }
                        SMData._transCache[origName] = translatedParts.join('_');
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
// 先从缓存取翻译结果，没有则返回原始名称
SMTool._translateName = function (name) {
    if (!name) return name;
    var cached = SMData._transCache[name];
    return cached || name;
};
