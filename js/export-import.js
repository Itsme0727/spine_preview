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

// ---- 保存骨骼截图为原始格式文件到指定目录（★ 保持上传时的原始图片格式）----
SMTool._saveCompanionImages = function (dirHandle) {
    var shotMap = SMTool._collectAllBoneScreenshots();
    var shotIds = Object.keys(shotMap);
    if (shotIds.length === 0) return Promise.resolve();

    // 获取或创建 _assets 子目录
    return dirHandle.getDirectoryHandle('_assets', { create: true }).then(function (assetsDir) {
        var promises = [];
        for (var i = 0; i < shotIds.length; i++) {
            var shotId = parseInt(shotIds[i]);
            var shotInfo = shotMap[shotId];
            if (!shotInfo || !shotInfo.dataUrl) continue;

            // ★ 从 dataUrl 检测原始图片格式，保持上传时的 MIME 类型
            var mime = 'image/png'; // 兜底
            var mimeMatch = shotInfo.dataUrl.match(/^data:(image\/\w+);/);
            if (mimeMatch) mime = mimeMatch[1];
            var ext = mime.split('/')[1]; // png, jpeg, gif, webp...
            if (ext === 'jpeg') ext = 'jpg';

            // ★ 使用 shotId 命名文件，同一 shotId 只存一份
            var fileName = 'img_' + shotId + '.' + ext;

            // ★ 为所有引用此 shotId 的节点设置 _boneShotRefs
            for (var r = 0; r < shotInfo.refs.length; r++) {
                var ref = shotInfo.refs[r];
                var node = SMData.nodes.get(ref.nodeId);
                if (node) {
                    if (!node._boneShotRefs) node._boneShotRefs = {};
                    if (!node._boneShotRefs[ref.boneName]) node._boneShotRefs[ref.boneName] = [];
                    node._boneShotRefs[ref.boneName][ref.idx] = '_assets/' + fileName;
                }
            }

            // 异步保存图片文件（原始二进制，不经过 canvas 重编码）
            (function (fn, dataUrl, sid, mimeType) {
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
            })(fileName, shotInfo.dataUrl, shotId, mime);
        }
        return Promise.all(promises);
    });
};

// ---- 从目录加载伴随 JPG 图片（★ 文件级去重加载：同名文件只读一次）----
// 返回 Promise<{loaded: number, missing: string[], total: number}>
SMTool._loadCompanionImages = function (dirHandle) {
    // 收集所有引用，按文件名去重
    var fileRefs = {}; // { fileName: [{node, boneName, idx}] }
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
                    fileRefs[fileName].push({ node: n, boneName: bn, idx: r });
                }
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

                                // 为所有引用此文件的节点设置 _boneScreenshots
                                for (var ri = 0; ri < refArr.length; ri++) {
                                    var ref = refArr[ri];
                                    if (!ref.node._boneScreenshots) ref.node._boneScreenshots = {};
                                    if (!ref.node._boneScreenshots[ref.boneName]) ref.node._boneScreenshots[ref.boneName] = [];
                                    if (!Array.isArray(ref.node._boneScreenshots[ref.boneName])) ref.node._boneScreenshots[ref.boneName] = [ref.node._boneScreenshots[ref.boneName]];
                                    ref.node._boneScreenshots[ref.boneName][ref.idx] = newShotId;
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
                        // ★ 文件不存在 → 记录缺失
                        missingList.push(fileName);
                        // 但不清除 _boneShotRefs，保留引用以便后续重试
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
                    fileRefs[fileName].push({ node: n, boneName: bn, idx: r });
                }
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
                                            if (!ref.node._boneScreenshots) ref.node._boneScreenshots = {};
                                            if (!ref.node._boneScreenshots[ref.boneName]) ref.node._boneScreenshots[ref.boneName] = [];
                                            if (!Array.isArray(ref.node._boneScreenshots[ref.boneName])) ref.node._boneScreenshots[ref.boneName] = [ref.node._boneScreenshots[ref.boneName]];
                                            ref.node._boneScreenshots[ref.boneName][ref.idx] = newShotId;
                                        }
                                        checkDone();
                                    };
                                    reader.onerror = function () {
                                        missingList.push(fileName);
                                        checkDone();
                                    };
                                    reader.readAsDataURL(file);
                                }, function () {
                                    missingList.push(fileName);
                                    checkDone();
                                });
                            },
                            function () {
                                // 文件不存在
                                missingList.push(fileName);
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
                    fileRefs[fileName].push({ node: n, boneName: bn, idx: r });
                }
            }
        }
        result = nodesIter.next();
    }

    var fileNames = Object.keys(fileRefs);
    var totalRefs = fileNames.length;
    if (totalRefs === 0) return Promise.resolve({ loaded: 0, missing: [], total: 0 });

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
                            if (!ref.node._boneScreenshots) ref.node._boneScreenshots = {};
                            if (!ref.node._boneScreenshots[ref.boneName]) ref.node._boneScreenshots[ref.boneName] = [];
                            if (!Array.isArray(ref.node._boneScreenshots[ref.boneName])) ref.node._boneScreenshots[ref.boneName] = [ref.node._boneScreenshots[ref.boneName]];
                            ref.node._boneScreenshots[ref.boneName][ref.idx] = newShotId;
                        }
                        console.log('[Path] ✅ 加载成功:', fileName);
                    } catch (e) {
                        console.log('[Path] ❌ 解析失败:', fileName, e.message);
                        missingList.push(fileName);
                    }
                    resolve();
                };
                img.onerror = function () {
                    console.log('[Path] ❌ 文件不存在:', fileName);
                    missingList.push(fileName);
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
            _boneTags: n._boneTags,
            _boneNotes: n._boneNotes,
            _boneFade: n._boneFade,
            // ★ 图片数据不嵌入 JSON！只存文件路径引用。
            // 实际图片保存在 _assets/ 目录中作为独立 JPG 文件。
            // 若伴随图片文件被删除，则图片真正丢失（符合预期）。
            _boneShotRefs: n._boneShotRefs
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
            color: grp.color
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
                color: g.color
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
                return SMTool._tryLoadCompanionImages();
            }).then(function () {
                SMTool._updateFloatPanel();
                SMTool._showSaveToast('导入完成');
            }).catch(function (err) {
                console.error('[Import] 传统导入失败:', err);
            });
        };
        r.readAsText(f);
    };
    inp.click();
};
