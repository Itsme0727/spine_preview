/* ================================================================
   导出/导入 — JSON 项目文件序列化与反序列化
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- dataURL → Blob 转换（保持原始图片格式）----
SMTool._dataUrlToBlob = function (dataUrl) {
    var parts = dataUrl.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var bytes = atob(parts[1]);
    var arr = new Uint8Array(bytes.length);
    for (var i = 0; i < bytes.length; i++) {
        arr[i] = bytes.charCodeAt(i);
    }
    return new Blob([arr], { type: mime });
};

// ---- 序列化截图数据（shotId → dataUrl，确保导出兼容性）----
SMTool._serializeShots = function (boneShots) {
    var out = {};
    var boneNames = Object.keys(boneShots);
    for (var i = 0; i < boneNames.length; i++) {
        var bn = boneNames[i];
        var shotList = boneShots[bn];
        if (!Array.isArray(shotList)) shotList = shotList ? [shotList] : [];
        out[bn] = [];
        for (var j = 0; j < shotList.length; j++) {
            var sv = shotList[j];
            out[bn].push((typeof sv === 'number') ? (SMData._shotGetDataUrl(sv) || sv) : sv);
        }
    }
    return out;
};

// ---- 收集所有节点的骨骼截图（去重）----
// 返回：{ shotId: { dataUrl, nodes: [{nodeId, boneName, idx}] } }
SMTool._collectAllBoneScreenshots = function () {
    var shotMap = {}; // shotId → { dataUrl, refs: [{nodeId, boneName, idx}] }
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        if (n._boneScreenshots && n.nodeType === 'spine') {
            var boneNames = Object.keys(n._boneScreenshots);
            for (var b = 0; b < boneNames.length; b++) {
                var bn = boneNames[b];
                var shotList = n._boneScreenshots[bn];
                if (!Array.isArray(shotList)) shotList = shotList ? [shotList] : [];
                for (var s = 0; s < shotList.length; s++) {
                    var shotVal = shotList[s];
                    var shotId = (typeof shotVal === 'number') ? shotVal : null;
                    if (shotId === null) continue;
                    var dataUrl = SMData._shotGetDataUrl(shotId);
                    if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) continue;
                    if (!shotMap[shotId]) {
                        shotMap[shotId] = { dataUrl: dataUrl, refs: [] };
                    }
                    shotMap[shotId].refs.push({ nodeId: n.id, boneName: bn, idx: s });
                }
            }
        }
        result = nodesIter.next();
    }
    return shotMap;
};

// ---- 保存骨骼截图 + 节点图片附件到 _assets/ 目录 ----
SMTool._saveCompanionImages = function (dirHandle) {
    // ★ 收集所有骨骼/皮肤/插槽截图
    var shotMap = SMTool._collectAllBoneScreenshots();
    // ★ 收集所有节点右上角图片附件
    var nodesIter = SMData.nodes.values();
    var nr = nodesIter.next();
    while (!nr.done) {
        var n = nr.value;
        if (n._nodeImages && n._nodeImages.length > 0 && (n.nodeType === 'spine' || n.nodeType === 'entry')) {
            for (var ni = 0; ni < n._nodeImages.length; ni++) {
                var shotId = n._nodeImages[ni];
                if (typeof shotId !== 'number') continue;
                if (shotMap[shotId]) {
                    // ★ 已存在（共享图片）→ 仅追加节点引用，不重复保存文件
                    (shotMap[shotId]._nodeRefs = shotMap[shotId]._nodeRefs || []).push({ nodeId: n.id, idx: ni });
                    continue;
                }
                var dataUrl = SMData._shotGetDataUrl(shotId);
                if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) continue;
                shotMap[shotId] = { dataUrl: dataUrl, refs: [] };
                (shotMap[shotId]._nodeRefs = shotMap[shotId]._nodeRefs || []).push({ nodeId: n.id, idx: ni });
            }
        }
        nr = nodesIter.next();
    }
    var shotIds = Object.keys(shotMap);

    // ★ 清空所有节点的引用，完全基于当前数据重建
    var nodesIter2 = SMData.nodes.values();
    var nr2 = nodesIter2.next();
    while (!nr2.done) {
        nr2.value._boneShotRefs = {};
        nr2.value._nodeShotRefs = [];
        nr2 = nodesIter2.next();
    }

    if (shotIds.length === 0) return Promise.resolve();

    return dirHandle.getDirectoryHandle('_assets', { create: true }).then(function (assetsDir) {
        var promises = [];
        var usedNames = {}; // 去重：同名文件自动加序号
        for (var i = 0; i < shotIds.length; i++) {
            var shotId = parseInt(shotIds[i]);
            var shotInfo = shotMap[shotId];
            if (!shotInfo || !shotInfo.dataUrl) continue;

            var mime = 'image/png';
            var mimeMatch = shotInfo.dataUrl.match(/^data:(image\/\w+);/);
            if (mimeMatch) mime = mimeMatch[1];
            var ext = mime.split('/')[1];
            if (ext === 'jpeg') ext = 'jpg';

            // ★ 优先使用上传时的原始文件名，无则用 shotId 生成
            var entry = SMData._shotStore[shotId];
            var baseName = (entry && entry._fileName) ? entry._fileName.replace(/\.[^.]+$/, '') : ('img_' + shotId);
            // 确保扩展名正确（原始文件名可能有不同扩展名，以实际 MIME 为准）
            var finalName = baseName + '.' + ext;
            // 同名冲突处理
            if (usedNames[finalName]) {
                var counter = 2;
                while (usedNames[baseName + '_' + counter + '.' + ext]) counter++;
                finalName = baseName + '_' + counter + '.' + ext;
            }
            usedNames[finalName] = true;

            // ★ 为所有引用此 shotId 的节点设置 _boneShotRefs
            for (var r = 0; r < shotInfo.refs.length; r++) {
                var ref = shotInfo.refs[r];
                var node = SMData.nodes.get(ref.nodeId);
                if (node) {
                    if (!node._boneShotRefs) node._boneShotRefs = {};
                    if (!node._boneShotRefs[ref.boneName]) node._boneShotRefs[ref.boneName] = [];
                    node._boneShotRefs[ref.boneName][ref.idx] = '_assets/' + finalName;
                }
            }
            // ★ 为节点右上角图片附件设置 _nodeShotRefs
            if (shotInfo._nodeRefs) {
                for (var rn = 0; rn < shotInfo._nodeRefs.length; rn++) {
                    var nref = shotInfo._nodeRefs[rn];
                    var nnode = SMData.nodes.get(nref.nodeId);
                    if (nnode) {
                        if (!nnode._nodeShotRefs) nnode._nodeShotRefs = [];
                        nnode._nodeShotRefs[nref.idx] = '_assets/' + finalName;
                    }
                }
            }

            (function (fn, dataUrl, sid) {
                var p = Promise.resolve().then(function () {
                    var blob = SMTool._dataUrlToBlob(dataUrl);
                    return assetsDir.getFileHandle(fn, { create: true }).then(function (fileHandle) {
                        return fileHandle.createWritable().then(function (writable) {
                            return writable.write(blob).then(function () {
                                return writable.close();
                            });
                        });
                    });
                }).catch(function (err) {
                    console.warn('[Export] Failed to save bone image ' + fn + ':', err);
                });
                promises.push(p);
            })(finalName, shotInfo.dataUrl, shotId);
        }
        return Promise.all(promises);
    });
};

// ---- 从目录加载伴随 JPG 图片（★ 文件级去重加载：同名文件只读一次）----
// 返回 Promise<{loaded: number, missing: string[], total: number}>
SMTool._loadCompanionImages = function (dirHandle) {
    // 收集所有引用，按文件名去重
    var fileRefs = {}; // { fileName: [{node, boneName, idx, type}] }
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        // 骨骼截图引用
        if (n._boneShotRefs && n.nodeType === 'spine') {
            var boneNames = Object.keys(n._boneShotRefs);
            for (var b = 0; b < boneNames.length; b++) {
                var bn = boneNames[b];
                var refList = n._boneShotRefs[bn];
                if (!Array.isArray(refList)) refList = refList ? [refList] : [];
                for (var r = 0; r < refList.length; r++) {
                    var refPath = refList[r];
                    if (!refPath) continue;
                    var fileName = refPath.replace('_assets/', '');
                    if (!fileRefs[fileName]) fileRefs[fileName] = [];
                    fileRefs[fileName].push({ node: n, boneName: bn, idx: r, type: 'bone' });
                }
            }
        }
        // ★ 节点右上角图片附件引用
        if (n._nodeShotRefs && n._nodeShotRefs.length > 0 && (n.nodeType === 'spine' || n.nodeType === 'entry')) {
            for (var ni = 0; ni < n._nodeShotRefs.length; ni++) {
                var refPath2 = n._nodeShotRefs[ni];
                if (!refPath2) continue;
                var fileName2 = refPath2.replace('_assets/', '');
                if (!fileRefs[fileName2]) fileRefs[fileName2] = [];
                fileRefs[fileName2].push({ node: n, idx: ni, type: 'nodeImage' });
            }
        }
        result = nodesIter.next();
    }

    var fileNames = Object.keys(fileRefs);
    var totalRefs = fileNames.length;
    if (totalRefs === 0) return Promise.resolve({ loaded: 0, missing: [], total: 0 });

    // 尝试打开 _assets 目录
    return dirHandle.getDirectoryHandle('_assets').then(function (assetsDir) {
        var loadedCount = 0;
        var missingList = [];
        var loadedCache = {}; // fileName → shotId
        var promises = [];

        // ★ 加载前：将所有 _nodeImages 中的旧 shotId 清空，防止
        // _nodeShotRefs 与 _nodeImages 不同步时残留旧 shotId 碰撞
        var clearIter = SMData.nodes.values();
        var cr = clearIter.next();
        while (!cr.done) {
            var cn = cr.value;
            if (cn._nodeImages && cn._nodeImages.length > 0 && (cn.nodeType === 'spine' || cn.nodeType === 'entry')) {
                for (var ci = 0; ci < cn._nodeImages.length; ci++) {
                    if (typeof cn._nodeImages[ci] === 'number') cn._nodeImages[ci] = null;
                }
            }
            cr = clearIter.next();
        }

        for (var f = 0; f < fileNames.length; f++) {
            var fn = fileNames[f];
            var refs = fileRefs[fn];

            (function (fileName, refArr) {
                promises.push(
                    assetsDir.getFileHandle(fileName).then(function (fileHandle) {
                        return fileHandle.getFile();
                    }).then(function (file) {
                        return new Promise(function (resolve, reject) {
                            var reader = new FileReader();
                            reader.onload = function () {
                                // ★ 注册到全局截图表（自动去重），存储 shotId
                                var newShotId = SMData._shotRegister(reader.result);
                                loadedCache[fileName] = newShotId;
                                loadedCount++;

                                // 为所有引用此文件的节点设置对应数据
                                for (var ri = 0; ri < refArr.length; ri++) {
                                    var ref = refArr[ri];
                                    if (ref.type === 'nodeImage') {
                                        // ★ 节点右上角图片附件
                                        if (!ref.node._nodeImages) ref.node._nodeImages = [];
                                        ref.node._nodeImages[ref.idx] = newShotId;
                                    } else {
                                        // 骨骼截图
                                        if (!ref.node._boneScreenshots) ref.node._boneScreenshots = {};
                                        if (!ref.node._boneScreenshots[ref.boneName]) ref.node._boneScreenshots[ref.boneName] = [];
                                        if (!Array.isArray(ref.node._boneScreenshots[ref.boneName])) ref.node._boneScreenshots[ref.boneName] = [ref.node._boneScreenshots[ref.boneName]];
                                        ref.node._boneScreenshots[ref.boneName][ref.idx] = newShotId;
                                    }
                                    // ★ 第一个引用已由 _shotRegister 计数，后续引用需额外 +1
                                    if (ri > 0) SMData._shotAddRef(newShotId);
                                }
                                resolve();
                            };
                            reader.onerror = function () {
                                missingList.push(fileName);
                                reject(new Error('读取失败: ' + fileName));
                            };
                            reader.readAsDataURL(file);
                        });
                    }).catch(function () {
                        // ★ 文件不存在 → 记录缺失，并清除对应节点的图片引用防止旧 shotId 碰撞
                        missingList.push(fileName);
                        for (var rj = 0; rj < refArr.length; rj++) {
                            var ref2 = refArr[rj];
                            if (ref2.type === 'nodeImage' && ref2.node._nodeImages) {
                                ref2.node._nodeImages[ref2.idx] = null;
                            }
                        }
                    })
                );
            })(fn, refs);
        }

        return Promise.allSettled ? Promise.allSettled(promises).then(function () {
            return { loaded: loadedCount, missing: missingList, total: totalRefs };
        }) : Promise.all(promises).then(function () {
            return { loaded: loadedCount, missing: missingList, total: totalRefs };
        }).catch(function () {
            return { loaded: loadedCount, missing: missingList, total: totalRefs };
        });
    }).catch(function () {
        // ★ _assets 目录不存在 → 所有文件都缺失
        return { loaded: 0, missing: fileNames.slice(), total: totalRefs };
    });
};

// ---- 旧 API 兜底：从 FileSystemDirectoryEntry 加载 _assets/ 截图 ----
// 当 getParent() 不可用时，webkitGetAsEntry().getParent() 仍可用
SMTool._loadCompanionImagesFromEntry = function (dirEntry) {
    // 收集引用（同 _loadCompanionImages）
    var fileRefs = {};
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        if (n._boneShotRefs && n.nodeType === 'spine') {
            var boneNames = Object.keys(n._boneShotRefs);
            for (var b = 0; b < boneNames.length; b++) {
                var bn = boneNames[b];
                var refList = n._boneShotRefs[bn];
                if (!Array.isArray(refList)) refList = refList ? [refList] : [];
                for (var r = 0; r < refList.length; r++) {
                    var refPath = refList[r];
                    if (!refPath) continue;
                    var fileName = refPath.replace('_assets/', '');
                    if (!fileRefs[fileName]) fileRefs[fileName] = [];
                    fileRefs[fileName].push({ node: n, boneName: bn, idx: r, type: 'bone' });
                }
            }
        }
        // ★ 同时收集节点图片附件引用
        if (n._nodeShotRefs && n._nodeShotRefs.length > 0 && (n.nodeType === 'spine' || n.nodeType === 'entry')) {
            for (var ni2 = 0; ni2 < n._nodeShotRefs.length; ni2++) {
                var rp2 = n._nodeShotRefs[ni2];
                if (!rp2) continue;
                var fn2 = rp2.replace('_assets/', '');
                if (!fileRefs[fn2]) fileRefs[fn2] = [];
                fileRefs[fn2].push({ node: n, idx: ni2, type: 'nodeImage' });
            }
        }
        result = nodesIter.next();
    }

    var fileNames = Object.keys(fileRefs);
    var totalRefs = fileNames.length;
    if (totalRefs === 0) return Promise.resolve({ loaded: 0, missing: [], total: 0 });

    return new Promise(function (resolve) {
        // 尝试通过旧 API 获取 _assets 子目录
        dirEntry.getDirectory('_assets', { create: false },
            function (assetsDir) {
                // _assets 目录存在 → 逐个读取文件
                var loadedCount = 0;
                var missingList = [];
                var pending = fileNames.length;
                if (pending === 0) { resolve({ loaded: 0, missing: [], total: 0 }); return; }

                function checkDone() {
                    pending--;
                    if (pending <= 0) {
                        resolve({ loaded: loadedCount, missing: missingList, total: totalRefs });
                    }
                }

                // ★ 加载前：清空所有旧 shotId，防止残留碰撞
                var clearIter2 = SMData.nodes.values();
                var cr2 = clearIter2.next();
                while (!cr2.done) {
                    var cn2 = cr2.value;
                    if (cn2._nodeImages && cn2._nodeImages.length > 0 && (cn2.nodeType === 'spine' || cn2.nodeType === 'entry')) {
                        for (var cj = 0; cj < cn2._nodeImages.length; cj++) {
                            if (typeof cn2._nodeImages[cj] === 'number') cn2._nodeImages[cj] = null;
                        }
                    }
                    cr2 = clearIter2.next();
                }

                for (var f = 0; f < fileNames.length; f++) {
                    (function (fileName, refArr) {
                        assetsDir.getFile(fileName, { create: false },
                            function (fileEntry) {
                                fileEntry.file(function (file) {
                                    var reader = new FileReader();
                                    reader.onload = function () {
                                        var newShotId = SMData._shotRegister(reader.result);
                                        loadedCount++;
                                        for (var ri = 0; ri < refArr.length; ri++) {
                                            var ref = refArr[ri];
                                            if (ref.type === 'nodeImage') {
                                                if (!ref.node._nodeImages) ref.node._nodeImages = [];
                                                ref.node._nodeImages[ref.idx] = newShotId;
                                            } else {
                                                if (!ref.node._boneScreenshots) ref.node._boneScreenshots = {};
                                                if (!ref.node._boneScreenshots[ref.boneName]) ref.node._boneScreenshots[ref.boneName] = [];
                                                if (!Array.isArray(ref.node._boneScreenshots[ref.boneName])) ref.node._boneScreenshots[ref.boneName] = [ref.node._boneScreenshots[ref.boneName]];
                                                ref.node._boneScreenshots[ref.boneName][ref.idx] = newShotId;
                                            }
                                            // ★ 第一个引用已由 _shotRegister 计数，后续引用需额外 +1
                                            if (ri > 0) SMData._shotAddRef(newShotId);
                                        }
                                        checkDone();
                                    };
                                    reader.onerror = function () {
                                        missingList.push(fileName);
                                        // ★ 清除引用
                                        for (var rj = 0; rj < refArr.length; rj++) {
                                            var ref2 = refArr[rj];
                                            if (ref2.type === 'nodeImage' && ref2.node._nodeImages) {
                                                ref2.node._nodeImages[ref2.idx] = null;
                                            }
                                        }
                                        checkDone();
                                    };
                                    reader.readAsDataURL(file);
                                }, function () {
                                    missingList.push(fileName);
                                    for (var rj2 = 0; rj2 < refArr.length; rj2++) {
                                        var ref3 = refArr[rj2];
                                        if (ref3.type === 'nodeImage' && ref3.node._nodeImages) {
                                            ref3.node._nodeImages[ref3.idx] = null;
                                        }
                                    }
                                    checkDone();
                                });
                            },
                            function () {
                                // 文件不存在
                                missingList.push(fileName);
                                for (var rj3 = 0; rj3 < refArr.length; rj3++) {
                                    var ref4 = refArr[rj3];
                                    if (ref4.type === 'nodeImage' && ref4.node._nodeImages) {
                                        ref4.node._nodeImages[ref4.idx] = null;
                                    }
                                }
                                checkDone();
                            }
                        );
                    })(fileNames[f], fileRefs[fileNames[f]]);
                }
            },
            function () {
                // _assets 目录不存在 → 全部缺失
                resolve({ loaded: 0, missing: fileNames.slice(), total: totalRefs });
            }
        );
    });
};

// ---- Electron 兜底：用 File.path 拼出 _assets/ 路径，fetch 读取 ----
SMTool._loadCompanionImagesFromPath = function (dirPath) {
    // 规范化路径：统一正斜杠，去掉末尾斜杠
    var base = dirPath.replace(/\\/g, '/').replace(/\/+$/, '');
    var assetsBase = base + '/_assets/';
    console.log('[Path] 尝试从路径加载 _assets/:', assetsBase);

    var fileRefs = {};
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        if (n._boneShotRefs && n.nodeType === 'spine') {
            var boneNames = Object.keys(n._boneShotRefs);
            for (var b = 0; b < boneNames.length; b++) {
                var bn = boneNames[b];
                var refList = n._boneShotRefs[bn];
                if (!Array.isArray(refList)) refList = refList ? [refList] : [];
                for (var r = 0; r < refList.length; r++) {
                    var refPath = refList[r];
                    if (!refPath) continue;
                    var fileName = refPath.replace('_assets/', '');
                    if (!fileRefs[fileName]) fileRefs[fileName] = [];
                    fileRefs[fileName].push({ node: n, boneName: bn, idx: r, type: 'bone' });
                }
            }
        }
        // ★ 同时收集节点图片附件引用
        if (n._nodeShotRefs && n._nodeShotRefs.length > 0 && (n.nodeType === 'spine' || n.nodeType === 'entry')) {
            for (var ni3 = 0; ni3 < n._nodeShotRefs.length; ni3++) {
                var rp3 = n._nodeShotRefs[ni3];
                if (!rp3) continue;
                var fn3 = rp3.replace('_assets/', '');
                if (!fileRefs[fn3]) fileRefs[fn3] = [];
                fileRefs[fn3].push({ node: n, idx: ni3, type: 'nodeImage' });
            }
        }
        result = nodesIter.next();
    }

    var fileNames = Object.keys(fileRefs);
    var totalRefs = fileNames.length;
    if (totalRefs === 0) return Promise.resolve({ loaded: 0, missing: [], total: 0 });

    // ★ 加载前：清空所有旧 shotId，防止残留碰撞
    var clearIter3 = SMData.nodes.values();
    var cr3 = clearIter3.next();
    while (!cr3.done) {
        var cn3 = cr3.value;
        if (cn3._nodeImages && cn3._nodeImages.length > 0 && (cn3.nodeType === 'spine' || cn3.nodeType === 'entry')) {
            for (var ck = 0; ck < cn3._nodeImages.length; ck++) {
                if (typeof cn3._nodeImages[ck] === 'number') cn3._nodeImages[ck] = null;
            }
        }
        cr3 = clearIter3.next();
    }

    var loadedCount = 0;
    var missingList = [];
    var fetches = [];

    for (var f = 0; f < fileNames.length; f++) {
        (function (fileName, refArr) {
            // 构造 file:// URL
            var url = 'file:///' + assetsBase + fileName;
            url = 'file:///' + url.replace(/^file:\/*/, '').replace(/\/+/g, '/');
            console.log('[Path] 加载:', url);

            // ★ 用 <img> 标签加载（比 fetch 更可靠，不受 CORS 限制）
            fetches.push(new Promise(function (resolve) {
                var img = new Image();
                img.onload = function () {
                    try {
                        var canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth || img.width;
                        canvas.height = img.naturalHeight || img.height;
                        var ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        var dataUrl = canvas.toDataURL('image/jpeg', 0.95);
                        var newShotId = SMData._shotRegister(dataUrl);
                        loadedCount++;
                        for (var ri = 0; ri < refArr.length; ri++) {
                            var ref = refArr[ri];
                            if (ref.type === 'nodeImage') {
                                if (!ref.node._nodeImages) ref.node._nodeImages = [];
                                ref.node._nodeImages[ref.idx] = newShotId;
                            } else {
                                if (!ref.node._boneScreenshots) ref.node._boneScreenshots = {};
                                if (!ref.node._boneScreenshots[ref.boneName]) ref.node._boneScreenshots[ref.boneName] = [];
                                if (!Array.isArray(ref.node._boneScreenshots[ref.boneName])) ref.node._boneScreenshots[ref.boneName] = [ref.node._boneScreenshots[ref.boneName]];
                                ref.node._boneScreenshots[ref.boneName][ref.idx] = newShotId;
                            }
                            if (ri > 0) SMData._shotAddRef(newShotId);
                        }
                        console.log('[Path] ✅ 加载成功:', fileName);
                    } catch (e) {
                        console.log('[Path] ❌ 解析失败:', fileName, e.message);
                        missingList.push(fileName);
                        for (var rj = 0; rj < refArr.length; rj++) {
                            var ref2 = refArr[rj];
                            if (ref2.type === 'nodeImage' && ref2.node._nodeImages) {
                                ref2.node._nodeImages[ref2.idx] = null;
                            }
                        }
                    }
                    resolve();
                };
                img.onerror = function () {
                    console.log('[Path] ❌ 文件不存在:', fileName);
                    missingList.push(fileName);
                    for (var rj2 = 0; rj2 < refArr.length; rj2++) {
                        var ref3 = refArr[rj2];
                        if (ref3.type === 'nodeImage' && ref3.node._nodeImages) {
                            ref3.node._nodeImages[ref3.idx] = null;
                        }
                    }
                    resolve();
                };
                img.src = url;
            }));
        })(fileNames[f], fileRefs[fileNames[f]]);
    }

    var settle = Promise.allSettled || function (arr) {
        return Promise.all(arr.map(function (p) {
            return p.then(function (v) { return { status: 'fulfilled', value: v }; })
                    .catch(function (e) { return { status: 'rejected', reason: e }; });
        }));
    };
    return settle(fetches).then(function () {
        console.log('[Path] 加载完毕: loaded=' + loadedCount + ' missing=' + missingList.length);
        return { loaded: loadedCount, missing: missingList, total: totalRefs };
    });
};
SMTool._serializeData = function () {
    var data = {
        nodes: [],
        connections: [],
        groups: [],
        view: SMData.view
    };

    // 序列化连线
    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        data.connections.push({
            id: c.id,
            fromNode: c.fromNode,
            fromState: c.fromState,
            toNode: c.toNode,
            toState: c.toState,
            condition: c.condition,
            cp1x: c.cp1x,
            cp1y: c.cp1y,
            cp2x: c.cp2x,
            cp2y: c.cp2y,
            color: c.color
        });
    }

    // 序列化节点
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        data.nodes.push({
            id: n.id,
            name: n.name,
            nodeType: n.nodeType,
            sourceFile: n.sourceFile || '',
            x: n.x,
            y: n.y,
            animations: n.animations,
            skins: n.skins,
            slots: n.slots,
            bones: n.bones,
            version: n.version,
            currentAnim: n.currentAnim,
            premultipliedAlpha: n.premultipliedAlpha,
            loop: n.loop,
            tracks: n.tracks,
            _srcSkelJson: n._srcSkelJson,
            _srcSkelBinBase64: n._srcSkelBinBase64,
            _srcAtlasText: n._srcAtlasText,
            _srcTexDataUrl: n._srcTexDataUrl,
            _srcTexDataUrls: n._srcTexDataUrls,
            _srcType: n._srcType,
            _srcFileNames: n._srcFileNames,
            _textContent: n._textContent,
            _exitText: n._exitText,
            _stateDesc: n._stateDesc,
            _customScale: n._customScale,
            _debugOffsetX: n._debugOffsetX || 0,
            _debugOffsetY: n._debugOffsetY || 0,
            _debugCanvasW: n._debugCanvasW || 0,
            _debugCanvasH: n._debugCanvasH || 0,
            _boneTags: n._boneTags,
            _boneNotes: n._boneNotes,
            _boneFade: n._boneFade,
            _boneShotRefs: n._boneShotRefs,
            // ★ 皮肤标记/备注/淡入淡出/截图引用
            _skinTags: n._skinTags,
            _skinNotes: n._skinNotes,
            _skinFade: n._skinFade,
            _skinShotRefs: n._skinShotRefs,
            // ★ 插槽标记/备注/淡入淡出/截图引用
            _slotTags: n._slotTags,
            _slotNotes: n._slotNotes,
            _slotFade: n._slotFade,
            _slotShotRefs: n._slotShotRefs,
            // ★ 图片节点数据
            _imageDataUrl: n._imageDataUrl || '',
            // ★ 节点面板右上角图片附件
            _nodeImages: n._nodeImages ? n._nodeImages.slice() : [],
            _nodeShotRefs: n._nodeShotRefs ? n._nodeShotRefs.slice() : []
        });
        result = nodesIter.next();
    }

    // 序列化分组
    for (var g = 0; g < SMData.groups.length; g++) {
        var grp = SMData.groups[g];
        var nodeIdArr = [];
        if (grp.nodeIds) {
            grp.nodeIds.forEach(function (nid) { nodeIdArr.push(nid); });
        }
        data.groups.push({
            id: grp.id,
            nodeIds: nodeIdArr,
            color: grp.color,
            title: grp.title || ''
        });
    }
    // 保存 nextGroupId，避免导入时 ID 冲突
    data.nextGroupId = SMData.nextGroupId;

    // 保存全局骨骼标签
    data._boneLabelStore = SMData._boneLabelStore;

    // ★ 保存预览缩放、吸附开关、动画流模式
    data._previewZooms = SMData._previewZooms || {};
    data._snapEnabled = SMData._snapEnabled !== false;
    data.flowMode = SMData.flowMode || 'full';
    data.renderMode = SMData.renderMode || 'perf';

    return JSON.stringify(data, null, 2);
};

// ---- 显示保存提示气泡（左下角） ----
SMTool._showSaveToast = function (msg) {
    var toast = document.getElementById('autoSaveToast');
    if (!toast) return;

    // 更新提示文本
    var textEl = toast.querySelector('.ast-text');
    if (textEl) textEl.textContent = msg || '已保存';

    // 重置动画：先移除再强制回流后添加
    toast.classList.remove('show');
    void toast.offsetWidth; // 强制回流
    toast.classList.add('show');

    // 2.5 秒后自动消失
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function () {
        toast.classList.remove('show');
    }, 2500);
};

// ---- 静默覆写 JSON 到指定文件句柄（用于拖入文件的直接覆写）----
SMTool._writeJsonToFileHandle = function (fileHandle) {
    var json = SMTool._serializeData();
    var blob = new Blob([json], { type: 'application/json' });
    return fileHandle.createWritable().then(function (writable) {
        return writable.write(blob).then(function () {
            return writable.close();
        });
    });
};

// ---- 使用 File System Access API 静默写入文件（含伴随图片）----
SMTool._writeFileSilently = function () {
    if (!SMData._assetsDirHandle) return Promise.reject('no handle');

    // ★ 先保存伴随 JPG 图片（填充 _boneShotRefs），再写 JSON（只含路径引用）
    return SMTool._saveCompanionImages(SMData._assetsDirHandle).then(function () {
        var json = SMTool._serializeData();
        var blob = new Blob([json], { type: 'application/json' });
        return SMData._assetsDirHandle.getFileHandle('spine-state-machine.json', { create: true }).then(function (fileHandle) {
            SMData._saveFileHandle = fileHandle;
            return fileHandle.createWritable().then(function (writable) {
                return writable.write(blob).then(function () {
                    return writable.close();
                });
            });
        });
    });
};

// ---- 通过浏览器下载（降级方案） ----
SMTool._downloadFile = function (filename) {
    var json = SMTool._serializeData();
    var b = new Blob([json], { type: 'application/json' });
    var u = URL.createObjectURL(b);
    var a = document.createElement('a');
    a.href = u;
    a.download = filename || 'spine-state-machine.json';
    a.click();
    URL.revokeObjectURL(u);
};

// ---- 开始自动保存（每 30 秒） ----
SMTool._startAutoSave = function () {
    if (SMData._autoSaveIntervalId) return;
    SMData._autoSaveIntervalId = setInterval(function () {
        if (!SMData._hasEverSaved || SMData.nodes.size === 0) return;

        if (SMData._assetsDirHandle) {
            SMTool._writeFileSilently().then(function () {
                SMTool._showSaveToast('已自动保存');
            }).catch(function (err) {
                console.error('[AutoSave] 静默保存失败:', err);
                SMData._assetsDirHandle = null;
                SMData._saveFileHandle = null;
            });
        } else if (SMData._dragSaveHandle) {
            // 拖入文件的句柄 → 直接覆写 JSON
            SMTool._writeJsonToFileHandle(SMData._dragSaveHandle).then(function () {
                SMTool._showSaveToast('已自动保存');
            }).catch(function (err) {
                console.error('[AutoSave] 覆写失败:', err);
                SMData._dragSaveHandle = null;
            });
        } else {
            SMTool._downloadFile('spine-state-machine.json');
            SMTool._showSaveToast('已自动保存');
        }
    }, 30000);
};

// ---- 停止自动保存 ----
SMTool._stopAutoSave = function () {
    if (SMData._autoSaveIntervalId) {
        clearInterval(SMData._autoSaveIntervalId);
        SMData._autoSaveIntervalId = null;
    }
};

// ---- 导出项目（手动触发：点击按钮或 CTRL+S） ----
SMTool.exportData = function () {
    if (SMData.nodes.size === 0) return;

    // ★ 优先级 1：已有目录句柄 → 静默覆写（含截图）
    if (SMData._assetsDirHandle) {
        SMTool._writeFileSilently().then(function () {
            SMTool._showSaveToast('已保存');
        }).catch(function (err) {
            console.error('[Export] 静默保存失败:', err);
            SMData._assetsDirHandle = null;
            SMData._saveFileHandle = null;
            SMData._dragSaveHandle = null;
            SMTool.exportData();
        });
        return;
    }

    // ★ 优先级 2：有拖入文件的句柄 → 直接覆写 JSON 到原文件（不含截图）
    if (SMData._dragSaveHandle) {
        SMTool._writeJsonToFileHandle(SMData._dragSaveHandle).then(function () {
            if (!SMData._hasEverSaved) { SMData._hasEverSaved = true; SMTool._startAutoSave(); }
            SMTool._showSaveToast('已保存');
        }).catch(function (err) {
            console.error('[Export] 直接覆写失败:', err);
            SMData._dragSaveHandle = null;
            // 降级：弹出目录选择器
            SMTool.exportData();
        });
        return;
    }

    // ★ 优先级 3：首次保存 → 目录选择器（JSON + _assets 图片）
    if (window.showDirectoryPicker) {
        window.showDirectoryPicker({ mode: 'readwrite' }).then(function (dirHandle) {
            SMData._assetsDirHandle = dirHandle;

            // ★ 先保存伴随 JPG 图片（填充 _boneShotRefs），再写 JSON（只含路径引用）
            return SMTool._saveCompanionImages(dirHandle).then(function () {
                return dirHandle.getFileHandle('spine-state-machine.json', { create: true }).then(function (fileHandle) {
                    SMData._saveFileHandle = fileHandle;
                    var json = SMTool._serializeData();
                    var blob = new Blob([json], { type: 'application/json' });
                    return fileHandle.createWritable().then(function (writable) {
                        return writable.write(blob).then(function () {
                            return writable.close();
                        });
                    });
                });
            });
        }).then(function () {
            if (!SMData._hasEverSaved) {
                SMData._hasEverSaved = true;
                SMTool._startAutoSave();
            }
            var shotCount = 0;
            var nodesIter3 = SMData.nodes.values();
            var r3 = nodesIter3.next();
            while (!r3.done) {
                var nd3 = r3.value;
                if (nd3._boneShotRefs) {
                    var refBones = Object.keys(nd3._boneShotRefs);
                    for (var rbi = 0; rbi < refBones.length; rbi++) {
                        var refList = nd3._boneShotRefs[refBones[rbi]];
                        if (Array.isArray(refList)) shotCount += refList.length;
                        else if (refList) shotCount++;
                    }
                }
                r3 = nodesIter3.next();
            }
            SMTool._showSaveToast(shotCount > 0 ? '已保存（含 ' + shotCount + ' 张截图文件）' : '已保存');
        }).catch(function (err) {
            if (err.name !== 'AbortError') {
                console.error('[Export] 保存失败:', err);
                // 降级：使用传统下载方式（仅 JSON，不含图片）
                SMTool._downloadFile('spine-state-machine.json');
                if (!SMData._hasEverSaved) {
                    SMData._hasEverSaved = true;
                    SMTool._startAutoSave();
                }
                SMTool._showSaveToast('已保存（仅JSON，图片保存失败）');
            }
        });
    } else {
        // 浏览器不支持 File System Access API → 降级为传统下载（仅 JSON）
        SMTool._downloadFile('spine-state-machine.json');
        if (!SMData._hasEverSaved) {
            SMData._hasEverSaved = true;
            SMTool._startAutoSave();
        }
        SMTool._showSaveToast('已保存（仅JSON）');
    }
};

// ---- 尝试加载伴随图片（★ 缺失时弹窗提示选择目录）----
SMTool._tryLoadCompanionImages = function () {
    // ★ 每次导入都重置关闭标记，新工程有缺失必须提醒
    SMData._missingPanelDismissed = false;

    // ★ 收集唯一文件名（多个节点引用同一文件时只算一次）
    var uniqueFiles = {};
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        if (n._boneShotRefs && n.nodeType === 'spine') {
            var boneNames = Object.keys(n._boneShotRefs);
            for (var b = 0; b < boneNames.length; b++) {
                var refList = n._boneShotRefs[boneNames[b]];
                var arr = Array.isArray(refList) ? refList : (refList ? [refList] : []);
                for (var r = 0; r < arr.length; r++) {
                    if (arr[r] && typeof arr[r] === 'string' && arr[r].indexOf('_assets/') === 0) {
                        uniqueFiles[arr[r].replace('_assets/', '')] = true;
                    }
                }
            }
        }
        // ★ 同时收集节点图片附件引用
        if (n._nodeShotRefs && n._nodeShotRefs.length > 0 && (n.nodeType === 'spine' || n.nodeType === 'entry')) {
            for (var ni = 0; ni < n._nodeShotRefs.length; ni++) {
                var rp = n._nodeShotRefs[ni];
                if (rp && typeof rp === 'string' && rp.indexOf('_assets/') === 0) {
                    uniqueFiles[rp.replace('_assets/', '')] = true;
                }
            }
        }
        result = nodesIter.next();
    }
    var fileNames = Object.keys(uniqueFiles);
    var refCount = fileNames.length;
    if (refCount === 0) return Promise.resolve({ loaded: 0, missing: [], total: 0 });

    // ★ 优先级 1：新 API 目录句柄 → 静默加载
    if (SMData._assetsDirHandle) {
        return SMTool._loadCompanionImages(SMData._assetsDirHandle).then(function (loadResult) {
            if (loadResult.missing && loadResult.missing.length > 0) {
                SMTool._reportMissingImages(loadResult);
            }
            return loadResult;
        }).catch(function (err) {
            console.warn('[Import] 加载失败:', err);
            return { loaded: 0, missing: [], total: refCount };
        });
    }

    // ★ 优先级 2：旧 API 目录条目（webkitGetAsEntry 兜底）→ 静默加载
    if (SMData._legacyDirEntry) {
        return SMTool._loadCompanionImagesFromEntry(SMData._legacyDirEntry).then(function (loadResult) {
            if (loadResult.missing && loadResult.missing.length > 0) {
                SMTool._reportMissingImages(loadResult);
            }
            return loadResult;
        }).catch(function (err) {
            console.warn('[Import] 旧 API 加载失败:', err);
            return { loaded: 0, missing: [], total: refCount };
        });
    }

    // ★ 优先级 3：Electron/VS Code File.path 兜底 → fetch file:// 读取
    if (SMData._dropDirPath) {
        return SMTool._loadCompanionImagesFromPath(SMData._dropDirPath).then(function (loadResult) {
            if (loadResult.missing && loadResult.missing.length > 0) {
                SMTool._reportMissingImages(loadResult);
            }
            return loadResult;
        }).catch(function (err) {
            console.warn('[Import] Path 加载失败:', err);
            return { loaded: 0, missing: [], total: refCount };
        });
    }

    // ★ 优先级 4：无任何目录访问 → 弹出目录选择器
    if (window.showDirectoryPicker) {
        return window.showDirectoryPicker({ mode: 'readwrite' }).then(function (dirHandle) {
            SMData._assetsDirHandle = dirHandle;
            return SMTool._loadCompanionImages(dirHandle);
        }).then(function (loadResult) {
            if (loadResult.missing && loadResult.missing.length > 0) {
                SMTool._reportMissingImages(loadResult);
            }
            return loadResult;
        }).catch(function (err) {
            if (err.name !== 'AbortError') {
                console.error('[Import] 目录选择失败:', err);
            }
            // ★ 用户取消或失败 → 显示缺失面板提醒
            var missingMap = {};
            var it2 = SMData.nodes.values();
            var rp = it2.next();
            while (!rp.done) {
                var nd = rp.value;
                if (nd._boneShotRefs && nd.nodeType === 'spine') {
                    var bns = Object.keys(nd._boneShotRefs);
                    for (var bi = 0; bi < bns.length; bi++) {
                        var rl = nd._boneShotRefs[bns[bi]];
                        var ar = Array.isArray(rl) ? rl : (rl ? [rl] : []);
                        for (var ri = 0; ri < ar.length; ri++) {
                            if (ar[ri] && typeof ar[ri] === 'string' && ar[ri].indexOf('_assets/') === 0) {
                                missingMap[ar[ri].replace('_assets/', '')] = true;
                            }
                        }
                    }
                }
                rp = it2.next();
            }
            var missingArr = Object.keys(missingMap);
            SMTool._reportMissingImages({ loaded: 0, missing: missingArr, total: missingArr.length });
            return { loaded: 0, missing: missingArr, total: missingArr.length };
        });
    }
    // 连 showDirectoryPicker 都没有 → 才显示缺失面板（唯一文件名）
    var allMissingMap = {};
    var nodesIter2 = SMData.nodes.values();
    var r2 = nodesIter2.next();
    while (!r2.done) {
        var nd = r2.value;
        if (nd._boneShotRefs && nd.nodeType === 'spine') {
            var bn2 = Object.keys(nd._boneShotRefs);
            for (var bi = 0; bi < bn2.length; bi++) {
                var rl = nd._boneShotRefs[bn2[bi]];
                var ar = Array.isArray(rl) ? rl : (rl ? [rl] : []);
                for (var ri = 0; ri < ar.length; ri++) {
                    if (ar[ri] && typeof ar[ri] === 'string' && ar[ri].indexOf('_assets/') === 0) {
                        allMissingMap[ar[ri].replace('_assets/', '')] = true;
                    }
                }
            }
        }
        r2 = nodesIter2.next();
    }
    var allMissing = Object.keys(allMissingMap);
    SMTool._reportMissingImages({ loaded: 0, missing: allMissing, total: allMissing.length });
    return Promise.resolve({ loaded: 0, missing: allMissing, total: allMissing.length });
};

// ---- 报告缺失的截图文件（缺失面板 + 状态栏，不阻塞用户）----
SMTool._reportMissingImages = function (loadResult) {
    if (!loadResult) return;
    var missing = loadResult.missing || [];
    var total = loadResult.total || 0;
    var loaded = loadResult.loaded || 0;

    if (missing.length === 0) {
        // ★ 全部成功 → 清除"已关闭"标记，下次有缺失时会重新提醒
        SMData._missingPanelDismissed = false;
        if (loaded > 0) {
            var sb = document.getElementById('sbStatus');
            if (sb) { sb.textContent = '✅ 已加载 ' + loaded + ' 张骨骼截图'; }
            setTimeout(function () { if (sb && sb.textContent.indexOf('已加载') === 0) sb.textContent = ''; }, 3000);
        }
        return;
    }

    // ★ 用户已主动关闭 → 不再弹出，避免反复打扰
    if (SMData._missingPanelDismissed) return;

    var sb = document.getElementById('sbStatus');
    if (sb) { sb.textContent = '⚠️ 缺失 ' + missing.length + '/' + total + ' 张截图（点击右侧面板重试）'; }

    SMTool._showMissingImages(missing, total, loaded);
};

// ---- 显示缺失截图通知面板（右上角，不自动关闭，用户手动关）----
SMTool._showMissingImages = function (missingList, total, loaded) {
    var panel = document.getElementById('missingPanel');
    var listEl = document.getElementById('missingList');
    if (!panel || !listEl) return;

    // 更新面板标题显示具体数量
    var header = panel.querySelector('.mp-header');
    if (header) {
        header.innerHTML = '⚠️ 缺失 ' + missingList.length + '/' + total + ' 张截图' +
            '<button class="mp-close" onclick="SMTool._closeMissingPanel()" title="关闭提示">✕</button>';
    }

    var html = '';
    html += '<div style="padding:4px 8px;font-size:11px;color:var(--text2)">已加载: ' + loaded + ' / 总计: ' + total + ' | 缺失: ' + missingList.length + '</div>';
    var maxShow = Math.min(missingList.length, 20);
    for (var i = 0; i < maxShow; i++) {
        html += '<div class="mp-item" style="font-size:10px;padding:2px 8px;word-break:break-all">📄 ' + missingList[i] + '</div>';
    }
    if (missingList.length > maxShow) {
        html += '<div class="mp-item" style="font-size:10px;padding:2px 8px;color:var(--text2)">...及其他 ' + (missingList.length - maxShow) + ' 个文件</div>';
    }
    html += '<div style="padding:6px 8px"><button onclick="SMTool._retryLoadMissingImages()" style="font-size:11px;cursor:pointer">🔄 重新选择目录并加载</button></div>';

    listEl.innerHTML = html;

    // ★ 显示面板（使用 show class），不自动隐藏
    panel.classList.add('show');
    clearTimeout(panel._hideTimer);
};

// ---- 重试加载缺失截图：让用户重新选择目录 ----
SMTool._retryLoadMissingImages = function () {
    if (!window.showDirectoryPicker) {
        alert('浏览器不支持目录选择，请使用 Chrome 或 Edge');
        return;
    }
    window.showDirectoryPicker({ mode: 'readwrite' }).then(function (dirHandle) {
        SMData._assetsDirHandle = dirHandle;
        return SMTool._loadCompanionImages(dirHandle);
    }).then(function (loadResult) {
        if (loadResult.missing && loadResult.missing.length > 0) {
            // 仍有缺失 → 更新面板
            SMTool._reportMissingImages(loadResult);
        } else {
            // 全部成功 → 关闭面板
            SMTool._closeMissingPanel();
            var sb = document.getElementById('sbStatus');
            if (sb) { sb.textContent = '✅ 已加载 ' + (loadResult.loaded || 0) + ' 张骨骼截图'; }
            setTimeout(function () { if (sb && sb.textContent.indexOf('已加载') === 0) sb.textContent = ''; }, 3000);
        }
        SMTool._updateFloatPanel();
    }).catch(function (err) {
        if (err.name !== 'AbortError') {
            console.error('[Retry] 加载失败:', err);
        }
    });
};

// ---- 导入项目（★ 使用目录选择器：一次选目录，JSON + _assets 截图全部自动加载）----
SMTool.importData = function () {
    if (window.showDirectoryPicker) {
        // ★ 一步：选择项目目录（JSON 和 _assets/ 在同一目录下）
        window.showDirectoryPicker({ mode: 'readwrite' }).then(function (dirHandle) {
            SMData._assetsDirHandle = dirHandle;

            // 在目录中查找 JSON 文件（优先 spine-state-machine.json，其次任意 .json）
            return dirHandle.getFileHandle('spine-state-machine.json').then(function (fileHandle) {
                return fileHandle.getFile().then(function (file) {
                    return { file: file, found: true };
                });
            }).catch(function () {
                // 默认文件名未找到 → 尝试列出目录中所有 .json 文件
                console.log('[Import] 未找到 spine-state-machine.json，扫描目录中其他 .json 文件...');
                var jsonFiles = [];
                var dirIter = dirHandle.values();
                function iterateNext() {
                    return dirIter.next().then(function (entryResult) {
                        if (entryResult.done) return Promise.resolve(jsonFiles);
                        var entry = entryResult.value;
                        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.json')) {
                            jsonFiles.push(entry);
                        }
                        return iterateNext();
                    });
                }
                return iterateNext().then(function (jsonFiles) {
                    if (jsonFiles.length === 0) {
                        throw new Error('目录中未找到任何 .json 项目文件');
                    }
                    // 使用找到的第一个 JSON 文件
                    var firstJsonHandle = jsonFiles[0];
                    console.log('[Import] 找到 JSON 文件:', firstJsonHandle.name);
                    return firstJsonHandle.getFile().then(function (file) {
                        return { file: file, found: true };
                    });
                });
            }).then(function (result) {
                if (!result || !result.found) throw new Error('未找到项目文件');
                return new Promise(function (resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function () { resolve(reader.result); };
                    reader.onerror = reject;
                    reader.readAsText(result.file);
                });
            });
        }).then(function (jsonText) {
            // 导入 JSON 数据
            return SMTool._processImportJson(jsonText, null);
        }).then(function () {
            // ★ 目录句柄已在上方设置，_tryLoadCompanionImages 自动静默加载截图
            return SMTool._tryLoadCompanionImages();
        }).then(function () {
            // ★ 预生成所有节点图片的缩略图（避免大图撑爆 img 标签）
            var nodesPre = SMData.nodes.values();
            var rPre = nodesPre.next();
            var thumbPromises = [];
            while (!rPre.done) {
                var nd = rPre.value;
                if (nd._nodeImages && nd._nodeImages.length > 0 && (nd.nodeType === 'spine' || nd.nodeType === 'entry')) {
                    for (var ti = 0; ti < nd._nodeImages.length; ti++) {
                        var sid = nd._nodeImages[ti];
                        if (typeof sid !== 'number') continue;
                        var entry = SMData._shotStore[sid];
                        if (entry && entry.dataUrl && !entry.thumbDataUrl && !entry._thumbPending) {
                            entry._thumbPending = true;
                            thumbPromises.push((function (shotId) {
                                return SMTool._generateThumbnail(entry.dataUrl).then(function (t) { return { sid: shotId, thumb: t }; });
                            })(sid));
                        }
                    }
                }
                rPre = nodesPre.next();
            }
            return Promise.all(thumbPromises).then(function (results) {
                for (var ri = 0; ri < results.length; ri++) {
                    var r = results[ri];
                    var ent = SMData._shotStore[r.sid];
                    if (ent) { ent.thumbDataUrl = r.thumb; ent._thumbPending = false; }
                }
            });
        }).then(function () {
            // ★ 刷新所有节点的图片附件缩略图
            var nodesIter4 = SMData.nodes.values();
            var r4 = nodesIter4.next();
            while (!r4.done) {
                if (r4.value._nodeImages && r4.value._nodeImages.length > 0 && (r4.value.nodeType === 'spine' || r4.value.nodeType === 'entry')) {
                    SMTool._refreshNodeImages(r4.value.id);
                }
                r4 = nodesIter4.next();
            }
            SMTool._updateFloatPanel();
            SMTool._showSaveToast('导入完成');
        }).catch(function (err) {
            if (err.name === 'AbortError') {
                // 用户取消目录选择 → 静默
                return;
            }
            console.error('[Import] 导入失败:', err);
            alert('导入失败：' + (err.message || '未知错误'));
        });
    } else {
        // 降级：不支持 File System Access API
        SMTool._importDataLegacy();
    }
};

// ---- 处理导入的 JSON 数据 ----
SMTool._processImportJson = function (jsonText, fileHandle) {
    return new Promise(function (resolve, reject) {
    try {
        SMTool.pushUndo();
        var d = JSON.parse(jsonText);

        // 恢复视图
        if (d.view) SMData.view = d.view;

        // 恢复连线
        SMData.connections = d.connections || [];

        // 恢复节点
        var nodeList = d.nodes || [];
        for (var i = 0; i < nodeList.length; i++) {
            var nd = nodeList[i];
            var node = new SpineNodeData(nd.id);
            node.name = nd.name;
            node.nodeType = nd.nodeType || 'spine';
            node.sourceFile = nd.sourceFile || '';
            // ★ 旧工程兼容：若 sourceFile 为空但保留了原始文件名，则从文件名重建
            if (!node.sourceFile && node._srcFileNames && node._srcFileNames.length > 0) {
                for (var fi = 0; fi < node._srcFileNames.length; fi++) {
                    var fn = node._srcFileNames[fi].toLowerCase();
                    if (fn.indexOf('.json') > 0 || fn.indexOf('.skel') > 0) {
                        node.sourceFile = node._srcFileNames[fi].replace(/\.(json|skel)$/i, '');
                        break;
                    }
                }
                if (!node.sourceFile) {
                    node.sourceFile = node._srcFileNames[0].replace(/\.[^.]+$/, '');
                }
            }
            node.x = nd.x || 0;
            node.y = nd.y || 0;
            node.animations = nd.animations || [];
            node.skins = nd.skins || [];
            node.slots = nd.slots || [];
            node.bones = nd.bones || [];
            node.version = nd.version || '';
            node.currentAnim = nd.currentAnim || '';
            node.premultipliedAlpha = nd.premultipliedAlpha || false;
            node._srcSkelJson = nd._srcSkelJson || null;
            node._srcSkelBinBase64 = nd._srcSkelBinBase64 || null;
            node._srcAtlasText = nd._srcAtlasText || '';
            node._srcTexDataUrl = nd._srcTexDataUrl || '';
            node._srcTexDataUrls = nd._srcTexDataUrls || [];
            node._srcType = nd._srcType || '';
            node._srcFileNames = nd._srcFileNames || [];
            node._textContent = nd._textContent || '';
            node._exitText = nd._exitText || '';
            node._stateDesc = nd._stateDesc || '';
            node.loop = (nd.loop !== undefined ? nd.loop : true);
            node.tracks = nd.tracks || [];
            node._customScale = (nd._customScale !== undefined ? nd._customScale : 1.0);
            node._debugOffsetX = (nd._debugOffsetX !== undefined ? nd._debugOffsetX : 0);
            node._debugOffsetY = (nd._debugOffsetY !== undefined ? nd._debugOffsetY : 0);
            node._debugCanvasW = (nd._debugCanvasW !== undefined ? nd._debugCanvasW : 0);
            node._debugCanvasH = (nd._debugCanvasH !== undefined ? nd._debugCanvasH : 0);
            node._boneTags = nd._boneTags || {};
            node._boneNotes = nd._boneNotes || {};
            node._boneFade = nd._boneFade || {};
            // ★ 新格式：JSON 中只有 _boneShotRefs（文件路径引用），图片由 _loadCompanionImages 加载
            // ★ 旧格式兼容：如果 JSON 中仍有 _boneScreenshots base64，则转换并注册
            node._boneScreenshots = {};
            if (nd._boneScreenshots) {
                // 旧项目文件兼容：将 base64 dataUrl 转为 shotId（下次保存时会转为 JPG 文件）
                var ssKeys = Object.keys(nd._boneScreenshots);
                for (var sk = 0; sk < ssKeys.length; sk++) {
                    var ssk = ssKeys[sk];
                    var rawVal = nd._boneScreenshots[ssk];
                    var shotArr = Array.isArray(rawVal) ? rawVal : (rawVal ? [rawVal] : []);
                    node._boneScreenshots[ssk] = [];
                    for (var sai = 0; sai < shotArr.length; sai++) {
                        var sv = shotArr[sai];
                        if (typeof sv === 'string' && sv.indexOf('data:image/') === 0) {
                            node._boneScreenshots[ssk].push(SMData._shotRegister(sv));
                        } else if (typeof sv === 'number') {
                            node._boneScreenshots[ssk].push(SMData._shotRegister(SMData._shotGetDataUrl(sv) || ''));
                        }
                    }
                }
            }
            node._boneShotRefs = nd._boneShotRefs || {};
            if (node._boneShotRefs) {
                var srKeys = Object.keys(node._boneShotRefs);
                for (var sri = 0; sri < srKeys.length; sri++) {
                    var srk = srKeys[sri];
                    if (node._boneShotRefs[srk] && !Array.isArray(node._boneShotRefs[srk])) {
                        node._boneShotRefs[srk] = [node._boneShotRefs[srk]];
                    }
                }
            }

            // ★ 皮肤标记/备注/淡入淡出/截图
            node._skinTags = nd._skinTags || {};
            node._skinNotes = nd._skinNotes || {};
            node._skinFade = nd._skinFade || {};
            node._skinScreenshots = {};
            if (nd._skinScreenshots) {
                var ssKeys2 = Object.keys(nd._skinScreenshots);
                for (var sk2 = 0; sk2 < ssKeys2.length; sk2++) {
                    var ssk2 = ssKeys2[sk2];
                    var rawVal2 = nd._skinScreenshots[ssk2];
                    var shotArr2 = Array.isArray(rawVal2) ? rawVal2 : (rawVal2 ? [rawVal2] : []);
                    node._skinScreenshots[ssk2] = [];
                    for (var sai2 = 0; sai2 < shotArr2.length; sai2++) {
                        var sv2 = shotArr2[sai2];
                        if (typeof sv2 === 'string' && sv2.indexOf('data:image/') === 0) {
                            node._skinScreenshots[ssk2].push(SMData._shotRegister(sv2));
                        } else if (typeof sv2 === 'number') {
                            node._skinScreenshots[ssk2].push(SMData._shotRegister(SMData._shotGetDataUrl(sv2) || ''));
                        }
                    }
                }
            }
            node._skinShotRefs = nd._skinShotRefs || {};

            // ★ 插槽标记/备注/淡入淡出/截图
            node._slotTags = nd._slotTags || {};
            node._slotNotes = nd._slotNotes || {};
            node._slotFade = nd._slotFade || {};
            node._slotScreenshots = {};
            if (nd._slotScreenshots) {
                var ssKeys3 = Object.keys(nd._slotScreenshots);
                for (var sk3 = 0; sk3 < ssKeys3.length; sk3++) {
                    var ssk3 = ssKeys3[sk3];
                    var rawVal3 = nd._slotScreenshots[ssk3];
                    var shotArr3 = Array.isArray(rawVal3) ? rawVal3 : (rawVal3 ? [rawVal3] : []);
                    node._slotScreenshots[ssk3] = [];
                    for (var sai3 = 0; sai3 < shotArr3.length; sai3++) {
                        var sv3 = shotArr3[sai3];
                        if (typeof sv3 === 'string' && sv3.indexOf('data:image/') === 0) {
                            node._slotScreenshots[ssk3].push(SMData._shotRegister(sv3));
                        } else if (typeof sv3 === 'number') {
                            node._slotScreenshots[ssk3].push(SMData._shotRegister(SMData._shotGetDataUrl(sv3) || ''));
                        }
                    }
                }
            }
            node._slotShotRefs = nd._slotShotRefs || {};

            // ★ 图片节点数据
            node._imageDataUrl = nd._imageDataUrl || '';
            // ★ 节点面板右上角图片附件
            node._nodeImages = nd._nodeImages || [];
            node._nodeShotRefs = nd._nodeShotRefs || [];

            SMData.nodes.set(nd.id, node);
            SMData.nextId = Math.max(SMData.nextId, nd.id + 1);

            SMTool._createEl(node);
            SMTool._updatePos(node);

            // 恢复 WebGL 渲染
            if (node._srcAtlasText && (node._srcTexDataUrl || (node._srcTexDataUrls && node._srcTexDataUrls.length > 0)) &&
                (node._srcSkelJson || node._srcSkelBinBase64)) {
                SMTool._loadFromSourceData(node).then(function () {
                    SMTool._updateEl(node);
                }).catch(function (err) {
                    console.error('[Import] Failed to restore rendering:', err);
                });
            }
        }

        // 更新 ID 计数器
        var maxConnId = 0;
        for (var j = 0; j < SMData.connections.length; j++) {
            maxConnId = Math.max(maxConnId, SMData.connections[j].id);
        }
        SMData.nextConnId = maxConnId + 1;

        // 恢复分组
        SMData.groups = (d.groups || []).map(function (g) {
            return {
                id: g.id,
                nodeIds: new Set(g.nodeIds || []),
                color: g.color,
                title: g.title || ''
            };
        });
        SMData.nextGroupId = d.nextGroupId || SMData.nextGroupId;

        // 恢复全局骨骼标签
        if (d._boneLabelStore) SMData._boneLabelStore = d._boneLabelStore;

        // ★ 恢复预览缩放、吸附开关、动画流模式
        if (d._previewZooms) SMData._previewZooms = d._previewZooms;
        if (d._snapEnabled !== undefined) SMData._snapEnabled = d._snapEnabled;
        if (d.flowMode) SMData.flowMode = d.flowMode;
        if (d.renderMode) SMData.renderMode = d.renderMode;

        // ★ 同步 UI 按钮状态
        var btnSnap = document.getElementById('btnSnap');
        if (btnSnap) btnSnap.classList.toggle('active', SMData._snapEnabled);
        if (d.flowMode) SMTool.setFlowMode(d.flowMode);
        if (d.renderMode) SMTool.setRenderMode(d.renderMode);

        SMTool._updateAllPos();
        SMTool._updateSB();
        SMTool._updateStateRowColors();
        SMTool._updateFloatPanel();

        resolve();
    } catch (err) {
        alert('导入失败：无效的 JSON 文件\n' + err.message);
        reject(err);
    }
    });
};

// ---- 传统导入方式（降级：不支持 File System Access API）----
SMTool._importDataLegacy = function () {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = function (e) {
        var f = e.target.files[0];
        if (!f) return;
        var r = new FileReader();
        r.onload = function () {
            SMTool._processImportJson(r.result, null).then(function () {
                // ★ 传统导入也尝试加载伴随图片
                try {
                    return SMTool._tryLoadCompanionImages();
                } catch (e) {
                    console.warn('[Import] 伴图加载异常:', e.message);
                    return Promise.resolve({ loaded: 0, missing: [], total: 0 });
                }
            }).then(function (loadResult) {
                // ★ 刷新所有节点的图片附件缩略图（入口节点和动画节点都需要）
                var nodesIter4b = SMData.nodes.values();
                var r4b = nodesIter4b.next();
                while (!r4b.done) {
                    if (r4b.value._nodeImages && r4b.value._nodeImages.length > 0 && (r4b.value.nodeType === 'spine' || r4b.value.nodeType === 'entry')) {
                        SMTool._refreshNodeImages(r4b.value.id);
                    }
                    r4b = nodesIter4b.next();
                }
                SMTool._updateFloatPanel();
                var msg = '导入完成';
                if (loadResult && loadResult.loaded > 0) msg += '（含 ' + loadResult.loaded + ' 张伴图）';
                else if (loadResult && loadResult.total > 0) msg += '（伴图未加载，请将 _assets/ 文件夹放在 JSON 同目录下）';
                SMTool._showSaveToast(msg);
            }).catch(function (err) {
                console.error('[Import] 传统导入失败:', err);
                alert('导入失败：' + (err.message || '未知错误'));
            });
        };
        r.readAsText(f);
    };
    inp.click();
};
