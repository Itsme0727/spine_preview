/* ================================================================
   UI/DOM 操作 — 节点 DOM 创建、更新、状态行颜色等
   负责: 创建/更新/删除 Spine 节点的 HTML DOM 元素、面板管理
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 创建节点 DOM ----
SMTool._createEl = function (node) {
    var el = document.createElement('div');
    el.className = 'spine-node';
    el.id = 'sn-' + node.id;
    el.style.minWidth = '260px';

    // 动画下拉框选项
    var missingForFile = (SMData._missingStates && node.sourceFile) ? (SMData._missingStates[node.sourceFile] || null) : null;
    var missingSet = missingForFile ? new Set(missingForFile.anims) : new Set();
    var animOptionsHtml = '';
    for (var ai = 0; ai < node.animations.length; ai++) {
        var aa = node.animations[ai];
        var sel = node.currentAnim === aa.name ? ' selected' : '';
        var isMissing = missingSet.has(aa.name);
        animOptionsHtml += '<option value="' + SMTool._esc(aa.name) + '"' + sel +
            (isMissing ? ' class="missing-option"' : '') + '>' +
            SMTool._esc(aa.name) + ' (' + aa.duration.toFixed(2) + 's)</option>';
    }
    if (!animOptionsHtml) animOptionsHtml = '<option value="">-- 无动画 --</option>';

    var curState = node.currentAnim || (node.animations[0] && node.animations[0].name) || '';

    var skinsHtml = '';
    for (var si = 0; si < node.skins.length; si++) {
        skinsHtml += '<span class="badge">' + SMTool._esc(node.skins[si]) + '</span>';
    }
    if (!skinsHtml) skinsHtml = '<span class="badge">无皮肤</span>';

    el.innerHTML =
        '<div class="header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
            '<div class="header-titles">' +
                (node.sourceFile ? '<span class="source-file">' + SMTool._esc(node.sourceFile) + '</span>' : '') +
                '<span class="name">' + SMTool._esc(node.name) + '</span>' +
            '</div>' +
            '<div class="btns">' +
                '<button onclick="event.stopPropagation();SMTool.copyNode(' + node.id + ',50,50);" title="复制节点">📋</button>' +
                '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')">✕</button>' +
            '</div>' +
        '</div>' +
        '<div class="spine-canvas-wrap" ondragover="event.preventDefault();event.stopPropagation()" ondrop="event.preventDefault();event.stopPropagation();SMTool._onND(event,' + node.id + ')">' +
            '<div style="color:var(--text2);padding:40px">拖入 Spine 文件</div>' +
        '</div>' +
        '<div class="anim-bar">' +
            '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'' + SMTool._esc(curState) + '\',\'input\')" title="连线输入"></div>' +
            '<select class="anim-select" onchange="SMTool._onAnimChange(' + node.id + ', this.value)">' + animOptionsHtml + '</select>' +
            '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'' + SMTool._esc(curState) + '\',\'output\')" title="连线输出"></div>' +
        '</div>' +
        '<div class="footer">' + skinsHtml + '<span class="badge" style="margin-left:auto">v' + SMTool._esc(node.version || '?') + '</span></div>';

    SMTool.nodesLayer.appendChild(el);
};

// ---- 更新节点 DOM ----
SMTool._updateEl = function (node) {
    var el = SMTool._getEl(node.id);
    if (!el) return;

    // 动画下拉框
    var sel = el.querySelector('.anim-select');
    if (sel) {
        var curVal = sel.value;
        var missingForFile2 = (SMData._missingStates && node.sourceFile) ? (SMData._missingStates[node.sourceFile] || null) : null;
        var missingSet2 = missingForFile2 ? new Set(missingForFile2.anims) : new Set();
        var optionsHtml = '';
        for (var ai = 0; ai < node.animations.length; ai++) {
            var a = node.animations[ai];
            var selected = node.currentAnim === a.name ? ' selected' : '';
            var isMissing2 = missingSet2.has(a.name);
            optionsHtml += '<option value="' + SMTool._esc(a.name) + '"' + selected +
                (isMissing2 ? ' class="missing-option"' : '') + '>' +
                SMTool._esc(a.name) + ' (' + a.duration.toFixed(2) + 's)</option>';
        }
        if (!optionsHtml) optionsHtml = '<option value="">-- 无动画 --</option>';
        sel.innerHTML = optionsHtml;
        // 确保选中当前动画
        if (node.currentAnim && sel.value !== node.currentAnim) {
            sel.value = node.currentAnim;
        }
    }

    // 更新连线圆点的 onclick 属性（指向当前状态）
    var curState = node.currentAnim || (node.animations[0] && node.animations[0].name) || '';
    var curStateEsc = SMTool._esc(curState);
    var inputDot = el.querySelector('.anim-bar .conn-dot.input');
    var outputDot = el.querySelector('.anim-bar .conn-dot.output');
    if (inputDot) inputDot.setAttribute('onclick', "event.stopPropagation();SMTool._onDot(" + node.id + ",'" + curStateEsc + "','input')");
    if (outputDot) outputDot.setAttribute('onclick', "event.stopPropagation();SMTool._onDot(" + node.id + ",'" + curStateEsc + "','output')");

    // 底部信息
    var ft = el.querySelector('.footer');
    if (ft) {
        var skinsHtml = '';
        for (var si = 0; si < node.skins.length; si++) {
            skinsHtml += '<span class="badge">' + SMTool._esc(node.skins[si]) + '</span>';
        }
        ft.innerHTML = (skinsHtml || '<span class="badge">无皮肤</span>') + '<span class="badge" style="margin-left:auto">v' + SMTool._esc(node.version || '?') + '</span>';
    }

    // 标题
    var hn = el.querySelector('.header .name');
    if (hn) { hn.textContent = node.name; hn.title = node.name; }
    var sf = el.querySelector('.header .source-file');
    if (node.sourceFile) {
        if (sf) { sf.textContent = node.sourceFile; }
        else {
            // 动态插入 source-file
            var titles = el.querySelector('.header-titles');
            if (titles) {
                var newSf = document.createElement('span');
                newSf.className = 'source-file';
                newSf.textContent = node.sourceFile;
                titles.insertBefore(newSf, titles.firstChild);
            }
        }
    }

    // PMA - handled via floating panel
};

// ---- 获取节点 DOM 元素 ----
SMTool._getEl = function (id) {
    return document.getElementById('sn-' + id);
};

// ---- 更新节点位置 ----
SMTool._updatePos = function (node) {
    var el = SMTool._getEl(node.id);
    if (!el) return;
    var z = SMData.view.zoom;
    var s = SMTool.worldToDOM(node.x, node.y);
    el.style.left = s.x + 'px';
    el.style.top = s.y + 'px';
    el.style.transform = 'scale(' + z + ')';
    el.style.transformOrigin = 'top left';
    SMTool._updateFloatLabels();
};

SMTool._updateAllPos = function () {
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        SMTool._updatePos(result.value);
        result = nodesIter.next();
    }
    SMTool._updateFloatLabels();
};

// ---- 浮动大字标签（缩放 < 40% 时显示，固定字号不随缩放放大）----
SMTool._floatLabels = {};

SMTool._updateFloatLabels = function () {
    var container = document.getElementById('floatLabels');
    if (!container) return;
    var z = SMData.view.zoom;
    var show = z < 0.40;
    var seen = {};

    if (show) {
        var nodesIter = SMData.nodes.values();
        var result = nodesIter.next();
        while (!result.done) {
            var node = result.value;
            if (!node.skeleton) { result = nodesIter.next(); continue; }
            seen[node.id] = true;

            var label = SMTool._floatLabels[node.id];
            if (!label) {
                label = document.createElement('div');
                label.className = 'float-label';
                container.appendChild(label);
                SMTool._floatLabels[node.id] = label;
            }
            label.style.display = '';

            var sp = SMTool.worldToCanvas(node.x, node.y);
            var fontSize = 22;
            label.style.left = sp.x + 'px';
            label.style.top = (sp.y - fontSize * 2) + 'px';
            label.style.fontSize = fontSize + 'px';

            var name = node.name || '';
            var state = node.currentAnim || '';
            label.innerHTML = '<span class="fl-name">' + SMTool._esc(name) + '</span>' +
                (state ? '<span class="fl-state">' + SMTool._esc(state) + '</span>' : '');
            result = nodesIter.next();
        }
    }

    var keys = Object.keys(SMTool._floatLabels);
    for (var i = 0; i < keys.length; i++) {
        var id = keys[i];
        if (!show || !seen[id]) {
            var old = SMTool._floatLabels[id];
            if (old) {
                if (!SMData.nodes.has(parseInt(id))) {
                    if (old.parentNode) old.remove();
                    delete SMTool._floatLabels[id];
                } else {
                    old.style.display = 'none';
                }
            }
        }
    }
};

// ---- 更新选中状态 ----
SMTool._updateSel = function () {
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        var el = SMTool._getEl(n.id);
        if (el) {
            el.classList.toggle('selected', SMData.selectedNodes.has(n.id));
            if (SMData.connecting && SMData.connecting.nodeId === n.id) {
                el.classList.add('connecting');
            } else {
                el.classList.remove('connecting');
            }
        }
        result = nodesIter.next();
    }
    // 更新浮窗面板数据
    SMTool._updateFloatPanel();
};

// ---- 更新左侧浮窗面板数据 ----
SMTool._updateFloatPanel = function () {
    var content = document.getElementById('dfpContent');
    var panel = document.getElementById('dataFloatPanel');
    if (!content || !panel) return;

    // 仅当单选一个节点时显示数据
    if (SMData.selectedNodes.size === 1 && SMData.selectedNode) {
        panel.classList.remove('inactive');
        var node = SMData.nodes.get(SMData.selectedNode);
        if (!node) { content.innerHTML = '<div class="dfp-hint">未找到节点数据</div>'; return; }

        var animsHtml = '';
        for (var ai = 0; ai < node.animations.length; ai++) {
            var a = node.animations[ai];
            var isActive = node.currentAnim === a.name;
            animsHtml += '<div class="dfp-row' + (isActive ? ' active' : '') + '"><span>' + SMTool._esc(a.name) + '</span><span>' + a.duration.toFixed(2) + 's</span></div>';
        }
        if (!animsHtml) animsHtml = '<div class="dfp-row">无</div>';

        var skinRows = '';
        for (var si = 0; si < node.skins.length; si++) {
            skinRows += '<div class="dfp-row">' + SMTool._esc(node.skins[si]) + '</div>';
        }
        if (!skinRows) skinRows = '<div class="dfp-row">default</div>';

        var boneRows = '';
        var curAnim = node.currentAnim || '';
        var storeKey = (node.sourceFile || node.name) + '||' + curAnim;
        var boneLabels = SMData._boneLabelStore[storeKey] || {};
        var boneMarks = SMData._boneMarkStore[storeKey] || {};
        for (var bi = 0; bi < node.bones.length; bi++) {
            var boneName = node.bones[bi];
            var label = boneLabels[boneName] || '';
            var isMarked = !!boneMarks[boneName];
            var labelHtml = '';
            if (label) {
                labelHtml = '<span class="dfp-bone-label" data-bone="' + SMTool._esc(boneName) + '" title="点击编辑标签">' +
                    SMTool._esc(label) +
                    '<span class="dfp-bone-label-del" data-bone="' + SMTool._esc(boneName) + '" title="删除标签">&times;</span>' +
                '</span>';
            }
            boneRows += '<div class="dfp-row dfp-bone-row" data-bone="' + SMTool._esc(boneName) + '">' +
                '<span class="dfp-bone-mark' + (isMarked ? ' active' : '') + '" data-bone="' + SMTool._esc(boneName) + '" title="标记骨骼位置">✚</span>' +
                '<span>' + SMTool._esc(boneName) + '</span>' +
                '<span class="dfp-bone-right">' + labelHtml + '</span></div>';
        }
        if (!boneRows) boneRows = '<div class="dfp-row">无</div>';

        var slotRows = '';
        for (var sli = 0; sli < node.slots.length; sli++) {
            slotRows += '<div class="dfp-row">' + SMTool._esc(node.slots[sli]) + '</div>';
        }
        if (!slotRows) slotRows = '<div class="dfp-row">无</div>';

        var sourceInfo = '';
        if (node._srcFileNames && node._srcFileNames.length > 0) {
            var sfRows = '';
            for (var sfi = 0; sfi < node._srcFileNames.length; sfi++) {
                sfRows += '<div class="dfp-row" style="word-break:break-all;font-size:11px">' + SMTool._esc(node._srcFileNames[sfi]) + '</div>';
            }
            sourceInfo = '<div class="dfp-section"><div class="dfp-section-title">📁 源文件 (' + node._srcFileNames.length + ')</div>' + sfRows + '</div>';
        } else if (node.sourceFile) {
            sourceInfo = '<div class="dfp-section"><div class="dfp-section-title">📁 源文件</div><div class="dfp-row" style="word-break:break-all">' + SMTool._esc(node.sourceFile) + '</div></div>';
        }

        content.innerHTML =
            '<div class="dfp-section"><div class="dfp-section-title">🏷️ 节点名称</div><div class="dfp-row">' + SMTool._esc(node.name) + '</div></div>' +
            sourceInfo +
            '<div class="dfp-section"><div class="dfp-section-title">📦 Spine 版本</div><div class="dfp-row"><span>版本</span><span>' + SMTool._esc(node.version || '未知') + '</span></div></div>' +
            '<div class="dfp-section"><div class="dfp-section-title">🎬 动画 (' + node.animations.length + ')</div>' + animsHtml + '</div>' +
            '<div class="dfp-section"><div class="dfp-section-title">🎨 皮肤 (' + node.skins.length + ')</div>' + skinRows + '</div>' +
            '<div class="dfp-section"><div class="dfp-section-title">🦴 骨骼 (' + node.bones.length + ')</div>' + boneRows + '</div>' +
            '<div class="dfp-section"><div class="dfp-section-title">🔧 插槽 (' + node.slots.length + ')</div>' + slotRows + '</div>' +
            '<div class="dfp-section"><div class="dfp-check-row"><input type="checkbox" id="dfpPma" ' + (node.premultipliedAlpha ? 'checked' : '') + ' onchange="SMTool._togglePMA(' + node.id + ',this.checked)"><label for="dfpPma">预乘 Alpha 通道</label></div></div>';
    } else if (SMData.selectedNodes.size > 1) {
        panel.classList.add('inactive');
        content.innerHTML = '<div class="dfp-hint">已多选 ' + SMData.selectedNodes.size + ' 个节点</div>';
    } else {
        panel.classList.add('inactive');
        content.innerHTML = '<div class="dfp-hint">点击一个 Spine 节点以查看其动画数据</div>';
    }
};

// ---- 更新状态栏 ----
SMTool._updateSB = function () {
    document.getElementById('sbNodes').textContent = '节点: ' + SMData.nodes.size;
    document.getElementById('sbConns').textContent = '连线: ' + SMData.connections.length;
};

// ---- 更新状态行颜色（按参与连线着色） ----
SMTool._updateStateRowColors = function () {
    var stateColors = new Map();

    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        var color = c.color || _connColor(i);
        var isSel = SMData.selectedConnection === c.id;
        var alpha = isSel ? '' : '44';

        // 来源节点
        if (!stateColors.has(c.fromNode)) stateColors.set(c.fromNode, new Map());
        var fromMap = stateColors.get(c.fromNode);
        if (!fromMap.has(c.fromState)) fromMap.set(c.fromState, []);
        fromMap.get(c.fromState).push({ color: color, alpha: alpha, isSel: isSel });

        // 目标节点
        if (!stateColors.has(c.toNode)) stateColors.set(c.toNode, new Map());
        var toMap = stateColors.get(c.toNode);
        if (!toMap.has(c.toState)) toMap.set(c.toState, []);
        toMap.get(c.toState).push({ color: color, alpha: alpha, isSel: isSel });
    }

    // 应用到 DOM — 为 anim-bar 着色
    var stateEntriesIter = stateColors.entries();
    var seResult = stateEntriesIter.next();
    while (!seResult.done) {
        var nid = seResult.value[0];
        var stateMap = seResult.value[1];
        var el = SMTool._getEl(nid);
        if (el) {
            var bar = el.querySelector('.anim-bar');
            if (bar) {
                // 获取当前动画名来匹配连接
                var node = SMData.nodes.get(nid);
                var curState = node ? node.currentAnim : '';
                var infos = stateMap.get(curState);
                if (infos && infos.length > 0) {
                    var info = infos[0];
                    bar.style.backgroundColor = info.color + info.alpha;
                    bar.style.borderLeft = '3px solid ' + info.color;
                } else {
                    bar.style.backgroundColor = '';
                    bar.style.borderLeft = '';
                }
            }
        }
        seResult = stateEntriesIter.next();
    }
};

// ---- PMA 切换 ----
SMTool._togglePMA = function (nid, v) {
    var node = SMData.nodes.get(nid);
    if (node) node.premultipliedAlpha = v;
};

// ---- 重复节点红色高亮检测 ----
SMTool._updateDuplicateHighlights = function () {
    var groups = new Map();
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        if (n.sourceFile && n.currentAnim) {
            var key = n.sourceFile + '|' + n.currentAnim;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(n.id);
        }
        result = nodesIter.next();
    }

    var duplicateIds = new Set();
    var groupEntriesIter = groups.values();
    var gResult = groupEntriesIter.next();
    while (!gResult.done) {
        if (gResult.value.length > 1) {
            for (var i = 0; i < gResult.value.length; i++) {
                duplicateIds.add(gResult.value[i]);
            }
        }
        gResult = groupEntriesIter.next();
    }

    var count = 0;
    var nodesIter2 = SMData.nodes.values();
    var result2 = nodesIter2.next();
    while (!result2.done) {
        var el2 = SMTool._getEl(result2.value.id);
        if (el2) {
            var isDup = duplicateIds.has(result2.value.id);
            el2.classList.toggle('duplicate-highlight', isDup);
            if (isDup) count++;
        }
        result2 = nodesIter2.next();
    }
    console.log('[DupCheck] 检测完成：' + SMData.nodes.size + ' 个节点，' + count + ' 个重复高亮');
};

// ---- 缺失状态检测 + 通知面板 ----
SMTool._checkMissingStates = function () {
    // 按 sourceFile 分组，收集每个文件的全部动画列表和已有 currentAnim
    var fileGroups = new Map(); // sourceFile → { allAnims: Set, existingAnims: Set, sampleNode: node }
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        if (n.sourceFile && n.animations.length > 0) {
            if (!fileGroups.has(n.sourceFile)) {
                fileGroups.set(n.sourceFile, { allAnims: new Set(), existingAnims: new Set(), sampleNode: n });
            }
            var g = fileGroups.get(n.sourceFile);
            for (var i = 0; i < n.animations.length; i++) {
                g.allAnims.add(n.animations[i].name);
            }
            if (n.currentAnim) g.existingAnims.add(n.currentAnim);
        }
        result = nodesIter.next();
    }

    // 计算每个文件缺失的状态
    SMData._missingStates = {}; // { sourceFile: [animName, ...] }
    var totalMissing = 0;
    var fileEntriesIter = fileGroups.entries();
    var feResult = fileEntriesIter.next();
    while (!feResult.done) {
        var sf = feResult.value[0];
        var g2 = feResult.value[1];
        var missing = [];
        var allIter = g2.allAnims.values();
        var aiResult = allIter.next();
        while (!aiResult.done) {
            if (!g2.existingAnims.has(aiResult.value)) {
                missing.push(aiResult.value);
            }
            aiResult = allIter.next();
        }
        if (missing.length > 0) {
            SMData._missingStates[sf] = { anims: missing, sampleNode: g2.sampleNode };
            totalMissing += missing.length;
        }
        feResult = fileEntriesIter.next();
    }

    // 更新通知面板
    var panel = document.getElementById('missingPanel');
    var list = document.getElementById('missingList');
    if (totalMissing > 0) {
        panel.classList.add('show');
        var html = '';
        var keys = Object.keys(SMData._missingStates);
        for (var k = 0; k < keys.length; k++) {
            var sf2 = keys[k];
            var info = SMData._missingStates[sf2];
            for (var a = 0; a < info.anims.length; a++) {
                var an = info.anims[a];
                html += '<div class="mp-item">' +
                    '<div class="mp-info">' +
                        '<div class="mp-file">' + SMTool._esc(sf2) + '</div>' +
                        '<div class="mp-state">⚠ ' + SMTool._esc(an) + ' 未被创建</div>' +
                    '</div>' +
                    '<button class="mp-btn" onclick="SMTool._createMissingNode(\'' + SMTool._esc(sf2) + '\',\'' + SMTool._esc(an) + '\')">创建</button>' +
                '</div>';
            }
        }
        list.innerHTML = html;
    } else {
        panel.classList.remove('show');
        list.innerHTML = '';
    }

    console.log('[MissingCheck] ' + SMData.nodes.size + ' 个节点，缺失 ' + totalMissing + ' 个状态');
};

// ---- 创建缺失的动画节点 ----
SMTool._createMissingNode = function (sourceFile, animName) {
    // 找到同文件的一个已有节点作为数据源
    var sourceNode = null;
    var nodesIter2 = SMData.nodes.values();
    var r2 = nodesIter2.next();
    while (!r2.done) {
        if (r2.value.sourceFile === sourceFile && r2.value._srcAtlasText) {
            sourceNode = r2.value;
            break;
        }
        r2 = nodesIter2.next();
    }
    if (!sourceNode) return;

    // 在视窗中心创建
    var wp = SMTool.canvasToWorld(window.innerWidth / 2, window.innerHeight / 2);
    var id = SMData.nextId++;
    var node = new SpineNodeData(id);
    node.name = SMTool._translateName(animName);
    node.sourceFile = sourceFile;
    node.x = wp.x;
    node.y = wp.y;
    node._srcSkelJson = sourceNode._srcSkelJson;
    node._srcSkelBinBase64 = sourceNode._srcSkelBinBase64;
    node._srcAtlasText = sourceNode._srcAtlasText;
    node._srcTexDataUrl = sourceNode._srcTexDataUrl;
    node._srcType = sourceNode._srcType;
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
        SMTool._updatePos(node);
        // 刷新同文件所有节点的下拉框（缺失标记需更新）
        var nodesIter3 = SMData.nodes.values();
        var r3 = nodesIter3.next();
        while (!r3.done) {
            if (r3.value.sourceFile === sourceFile && r3.value.id !== node.id) {
                SMTool._updateEl(r3.value);
            }
            r3 = nodesIter3.next();
        }
        SMTool._checkMissingStates();
        SMTool._updateDuplicateHighlights();
        SMTool._refreshAllTranslations();
        SMTool._updateSB();
    }).catch(function (err) {
        console.error('[MissingCreate] Failed:', err);
    });

    SMTool._updateSB();
    document.getElementById('sbStatus').textContent = '已创建: ' + animName;
    setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
};
