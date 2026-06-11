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
    if (node.nodeType === 'textBox') el.classList.add('text-box-node');
    if (node.nodeType === 'shortText') el.classList.add('short-text-node');
    el.id = 'sn-' + node.id;
    el.style.minWidth = '200px';

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

    var currentSkin = node.currentSkin || (node.skeletonData && node.skeletonData.defaultSkin && node.skeletonData.defaultSkin.name) || (node.skins[0] || '');
    var skinsHtml = '';
    for (var si = 0; si < node.skins.length; si++) {
        var skinName = node.skins[si];
        var isActive = skinName === currentSkin ? ' active' : '';
        skinsHtml += '<span class="badge skin-badge' + isActive + '" onclick="event.stopPropagation();SMTool._setSkin(' + node.id + ',\'' + SMTool._escAttr(skinName) + '\')" title="切换皮肤: ' + SMTool._esc(skinName) + '">' + SMTool._esc(skinName) + '</span>';
    }
    if (!skinsHtml) skinsHtml = '<span class="badge">无皮肤</span>';

    if (node.nodeType === 'shortText' || node.nodeType === 'textBox') {
        var textContent = SMTool._esc(node._textContent || '');
        if (node.nodeType === 'shortText') {
            el.innerHTML =
                '<div class="header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
                    '<span class="name" style="font-size:39px">' + SMTool._esc(node.name) + '</span>' +
                    '<div class="btns">' +
                        '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" title="删除节点">✕</button>' +
                    '</div>' +
                '</div>' +
                '<textarea class="text-node-input" oninput="SMTool._updateTextNode(' + node.id + ',this.value);this.style.height=\'auto\';this.style.height=this.scrollHeight+\'px\'" onclick="event.stopPropagation()" placeholder="输入条件...">' + textContent + '</textarea>' +
                '<div class="anim-bar" style="margin-top:4px">' +
                    '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'text\',\'input\')" title="连线输入"></div>' +
                    '<span style="flex:1"></span>' +
                    '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'text\',\'output\')" title="连线输出"></div>' +
                '</div>' +
                '<span class="scale-handle" onmousedown="event.stopPropagation();SMTool._onScaleStart(event,' + node.id + ')" title="拖拽缩放"><i class="scale-handle-icon"></i></span>';
        } else {
            // textBox
            el.innerHTML =
                '<div class="header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
                    '<input class="text-box-title" value="' + SMTool._esc(node.name) + '" oninput="SMTool._updateTextNodeName(' + node.id + ',this.value)" onclick="event.stopPropagation()" style="width:0;flex:1;min-width:0;background:transparent;border:none;color:var(--text);font-size:39px;font-weight:600;outline:none">' +
                    '<div class="btns">' +
                        '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" title="删除节点">✕</button>' +
                    '</div>' +
                '</div>' +
                '<div class="text-box-area" contenteditable="true" oninput="SMTool._updateTextNode(' + node.id + ',this.innerText)" onclick="event.stopPropagation()">' + textContent + '</div>' +
                '<div class="anim-bar" style="margin-top:4px">' +
                    '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'text\',\'input\')" title="连线输入"></div>' +
                    '<span style="flex:1"></span>' +
                    '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'text\',\'output\')" title="连线输出"></div>' +
                '</div>' +
                '<span class="scale-handle" onmousedown="event.stopPropagation();SMTool._onScaleStart(event,' + node.id + ')" title="拖拽缩放"><i class="scale-handle-icon"></i></span>';
        }
    } else if (node.nodeType === 'layer') {
        SMTool._createLayerEl(node);
        return;
    } else if (node.nodeType === 'entry') {
        el.classList.add('entry-node');
        var entryText = SMTool._esc(node._exitText || '');
        var entryName = SMTool._esc(node.name || '阶段号');
        el.innerHTML =
            '<div class="header entry-header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
                '<input class="entry-title-input" value="' + entryName + '" ' +
                    'oninput="SMTool._updateEntryName(' + node.id + ',this.value)" ' +
                    'onclick="event.stopPropagation()" ' +
                    'onkeydown="event.stopPropagation()" ' +
                    'style="background:transparent;border:none;color:#fff;font-size:39px;font-weight:600;outline:none;width:0;flex:1;min-width:0">' +
                '<div class="entry-header-btns">' +
                    '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" title="删除节点">✕</button>' +
                '</div>' +
            '</div>' +
            '<div class="entry-body">' +
                '<textarea class="entry-text-input" oninput="SMTool._updateExitText(' + node.id + ',this.value);this.style.height=\'auto\';this.style.height=this.scrollHeight+\'px\'" onclick="event.stopPropagation()" placeholder="输入入口条件...">' + entryText + '</textarea>' +
            '</div>' +
            '<div class="anim-bar" style="display:flex;justify-content:space-between">' +
                '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'entry\',\'input\')" title="连线输入"></div>' +
                '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'entry\',\'output\')" title="连线输出"></div>' +
            '</div>' +
            '<div class="entry-img-bar">' +
                '<button class="node-img-add-btn" onclick="event.stopPropagation();SMTool._pickNodeImage(' + node.id + ')" ondragover="event.preventDefault();event.stopPropagation()" ondrop="event.preventDefault();event.stopPropagation();SMTool._dropNodeImage(event,' + node.id + ')" title="添加图片附件">📷 添加图片</button>' +
            '</div>' +
            '<span class="scale-handle" onmousedown="event.stopPropagation();SMTool._onScaleStart(event,' + node.id + ')" title="拖拽缩放"><i class="scale-handle-icon"></i></span>';
    } else if (node.nodeType === 'exit') {
        el.classList.add('exit-node');
        var exitText = SMTool._esc(node._exitText || '');
        el.innerHTML =
            '<div class="header exit-header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
                '<span class="exit-title">🏁 出口</span>' +
                '<div class="exit-header-btns">' +
                    '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" title="删除节点">✕</button>' +
                '</div>' +
            '</div>' +
            '<div class="exit-body">' +
                '<textarea class="exit-text-input" oninput="SMTool._updateExitText(' + node.id + ',this.value);this.style.height=\'auto\';this.style.height=this.scrollHeight+\'px\'" onclick="event.stopPropagation()" placeholder="输入出口条件...">' + exitText + '</textarea>' +
            '</div>' +
            '<div class="anim-bar" style="display:flex;justify-content:flex-start">' +
                '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'exit\',\'input\')" title="连线输入"></div>' +
            '</div>' +
            '<span class="scale-handle" onmousedown="event.stopPropagation();SMTool._onScaleStart(event,' + node.id + ')" title="拖拽缩放"><i class="scale-handle-icon"></i></span>';
    } else if (node.nodeType === 'titleText') {
        el.classList.add('title-node');
        var titleText = SMTool._esc(node._textContent || '标题');
        el.innerHTML =
            '<div class="title-text" contenteditable="false" ' +
                'ondblclick="event.stopPropagation();this.contentEditable=\'true\';this.focus();document.execCommand(\'selectAll\')" ' +
                'onblur="this.contentEditable=\'false\';SMTool._updateTitleText(' + node.id + ',this.innerText)" ' +
                'onkeydown="if(event.key===\'Escape\'){this.blur()}" ' +
                'onmousedown="if(this.contentEditable===\'false\'){event.stopPropagation();SMTool._onHD(event,' + node.id + ')}" ' +
                '>' + titleText + '</div>' +
            '<span class="title-scale-handle" onmousedown="event.stopPropagation();SMTool._onScaleStart(event,' + node.id + ')" title="拖拽缩放"><i class="scale-handle-icon"></i></span>';
    } else if (node.nodeType === 'image') {
        el.classList.add('image-node');
        var imgSrc = node._imageDataUrl || '';
        el.innerHTML =
            '<div class="header image-header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
                '<span class="image-title">🖼️ 图片</span>' +
                '<div class="image-header-btns">' +
                    '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" title="删除节点">✕</button>' +
                '</div>' +
            '</div>' +
            '<div class="image-body" style="padding:6px;overflow:hidden">' +
                '<img src="' + imgSrc + '" style="width:100%;display:block;border-radius:6px" draggable="false">' +
            '</div>' +
            '<span class="scale-handle" onmousedown="event.stopPropagation();SMTool._onScaleStart(event,' + node.id + ')" title="拖拽缩放"><i class="scale-handle-icon"></i></span>';
    } else if (node.nodeType === 'delayer') {
        el.classList.add('delayer-node');
        if (node._delayValue === undefined) node._delayValue = 1.0;
        var delayVal = node._delayValue;
        el.innerHTML =
            '<div class="header delayer-header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
                '<span class="delayer-title">⏱ 延时器</span>' +
                '<div class="btns">' +
                    '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" title="删除节点">✕</button>' +
                '</div>' +
            '</div>' +
            '<div class="delayer-body">' +
                '<div class="delayer-set-row">' +
                    '<button class="delayer-step-btn" onclick="event.stopPropagation();SMTool._delayerStep(' + node.id + ',-0.1)">◀</button>' +
                    '<input type="number" class="delayer-input" value="' + delayVal + '" step="0.001" min="0.001" ' +
                        'onchange="event.stopPropagation();SMTool._delayerSet(' + node.id + ',parseFloat(this.value)||1.0)" ' +
                        'onclick="event.stopPropagation()" onkeydown="event.stopPropagation()">' +
                    '<button class="delayer-step-btn" onclick="event.stopPropagation();SMTool._delayerStep(' + node.id + ',0.1)">▶</button>' +
                    '<span class="delayer-unit">秒</span>' +
                '</div>' +
                '<div class="delayer-progress-wrap">' +
                    '<div class="delayer-progress-bar" id="delayerBar-' + node.id + '"></div>' +
                '</div>' +
            '</div>' +
            '<div class="anim-bar" style="display:flex;justify-content:space-between">' +
                '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'delayer\',\'input\')" title="连线输入"></div>' +
                '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'delayer\',\'output\')" title="连线输出"></div>' +
            '</div>' +
            '<span class="scale-handle" onmousedown="event.stopPropagation();SMTool._onScaleStart(event,' + node.id + ')" title="拖拽缩放"><i class="scale-handle-icon"></i></span>';
    } else {
    el.innerHTML =
        SMTool._buildNodeIndicatorsHtml(node) +
        '<div class="header" onmousedown="event.stopPropagation();SMTool._onHD(event,' + node.id + ')">' +
            '<div class="header-titles">' +
                (node.sourceFile ? '<span class="source-file">' + SMTool._esc(node.sourceFile) + '</span>' : '') +
                '<span class="name">' + SMTool._esc(node.currentAnim || node.name) + '</span>' +
            '</div>' +
            '<div class="btns">' +
                '<button onclick="event.stopPropagation();SMTool._debugNode(' + node.id + ')" title="调试动画层位置/缩放">🔍</button>' +
                '<button onclick="event.stopPropagation();SMTool.copyNode(' + node.id + ',50,50);" title="复制节点">📋</button>' +
                '<button onclick="event.stopPropagation();SMTool.deleteNode(' + node.id + ')" title="删除节点">✕</button>' +
            '</div>' +
        '</div>' +
        '<div class="spine-canvas-wrap" ondragover="event.preventDefault();event.stopPropagation()" ondrop="event.preventDefault();event.stopPropagation();SMTool._onND(event,' + node.id + ')">' +
            '<div style="color:var(--text2);padding:40px">拖入 Spine 文件</div>' +
        '</div>' +
        '<div class="anim-bar">' +
            '<div class="conn-dot input" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'' + SMTool._escAttr(curState) + '\',\'input\')" title="连线输入"></div>' +
            '<select class="anim-select" onchange="SMTool._onAnimChange(' + node.id + ', this.value)">' + animOptionsHtml + '</select>' +
            '<div class="anim-progress-bar"></div>' +
            '<div class="conn-dot output" onclick="event.stopPropagation();SMTool._onDot(' + node.id + ',\'' + SMTool._escAttr(curState) + '\',\'output\')" title="连线输出"></div>' +
        '</div>' +
        // ---- 多轨道混合面板 ----
        '<div class="track-panel" id="trackPanel-' + node.id + '">' +
            SMTool._buildTrackPanelHtml(node) +
        '</div>' +
        '<div class="footer">' +
            '<div class="footer-controls">' +
                '<button class="loop-toggle' + (node.loop !== false ? ' active' : '') + '" onclick="event.stopPropagation();SMTool._toggleLoop(' + node.id + ')">' + (node.loop !== false ? '🔄 循环播放' : '▶ 单次播放') + '</button>' +
                '<label class="pma-toggle" title="预乘 Alpha"><input type="checkbox" onchange="SMTool._togglePMA(' + node.id + ',this.checked)"' + (node.premultipliedAlpha ? ' checked' : '') + '>预乘Alpha</label>' +
            '</div>' +
            '<div class="footer-skins"><span class="skin-label">皮肤</span>' + skinsHtml + '</div>' +
        '</div>' +
        '<div class="node-extras">' +
            '<div class="bone-tags" id="boneTags-' + node.id + '"></div>' +
            '<div class="state-desc-row">' +
                '<textarea class="state-desc" placeholder="点击输入此状态的描述" oninput="SMTool._updateStateDesc(' + node.id + ',this.value)" onclick="event.stopPropagation()">' + SMTool._esc(node._stateDesc || '') + '</textarea>' +
                '<button class="node-img-add-btn" onclick="event.stopPropagation();SMTool._pickNodeImage(' + node.id + ')" ondragover="event.preventDefault();event.stopPropagation()" ondrop="event.preventDefault();event.stopPropagation();SMTool._dropNodeImage(event,' + node.id + ')" title="添加图片附件">📷</button>' +
            '</div>' +
            '<span class="version-badge">v' + SMTool._esc(node.version || '?') + '</span>' +
        '</div>' +
        '<span class="scale-handle" onmousedown="event.stopPropagation();SMTool._onScaleStart(event,' + node.id + ')" title="拖拽缩放"><i class="scale-handle-icon"></i></span>';
    }

    SMTool.nodesLayer.appendChild(el);

    // ★ 初始化：已有状态描述内容时标黄 + 撑开高度
    // 使用 setTimeout(0) 延迟到浏览器完成布局后再读 scrollHeight，
    // 否则 appendChild 后同步读取永远是 0，高度被 min-height:96px 锁死
    if (node._stateDesc && node._stateDesc.trim().length > 0) {
        var taInit = el.querySelector('.state-desc');
        if (taInit) {
            taInit.classList.add('has-content');
            (function (ta) {
                setTimeout(function () {
                    ta.style.height = '0px';
                    ta.style.height = ta.scrollHeight + 'px';
                }, 0);
            })(taInit);
        }
    }
    // ★ 初始化：已有节点附件图片时渲染缩略图
    if (node._nodeImages && node._nodeImages.length > 0) {
        SMTool._refreshNodeImages(node.id);
    }
};

// ================================================================
//  多轨道动画混合面板
// ================================================================

// ★ 构建节点顶部指示图标 HTML
SMTool._buildNodeIndicatorsHtml = function (node) {
    var html = '<div class="node-indicators">';
    // 皮肤（有标记/备注/截图内容时显示，角标为已标记数量）
    var skinMarked = 0;
    for (var si = 0; si < (node.skins || []).length; si++) {
        var skn = node.skins[si];
        if ((node._skinTags && node._skinTags[skn]) ||
            (node._skinNotes && node._skinNotes[skn] && node._skinNotes[skn].trim().length > 0) ||
            (node._skinScreenshots && node._skinScreenshots[skn] && (Array.isArray(node._skinScreenshots[skn]) ? node._skinScreenshots[skn].length > 0 : true))) {
            skinMarked++;
        }
    }
    // ★ 仅在有标记内容时才显示皮肤图标（无标记则不出现）
    if (skinMarked > 0) {
        html += '<button class="ndi-btn ndi-skin" title="皮肤: ' + skinMarked + ' 个" onclick="event.stopPropagation();SMTool._onIndicatorClick(' + node.id + ',\'skin\')" style="position:relative">🎨<span class="ndi-count">' + skinMarked + '</span></button>';
    }
    // 骨骼（仅当有标记内容时显示，角标为已标记数量）
    var boneMarked = 0;
    for (var bi = 0; bi < (node.bones || []).length; bi++) {
        var bn = node.bones[bi];
        if ((node._boneTags && node._boneTags[bn]) ||
            (node._boneNotes && node._boneNotes[bn] && node._boneNotes[bn].trim().length > 0) ||
            (node._boneScreenshots && node._boneScreenshots[bn] && (Array.isArray(node._boneScreenshots[bn]) ? node._boneScreenshots[bn].length > 0 : true)) ||
            (node._boneFade && node._boneFade[bn] && node._boneFade[bn].enabled)) {
            boneMarked++;
        }
    }
    if (boneMarked > 0) {
        html += '<button class="ndi-btn ndi-bone" title="骨骼: ' + boneMarked + ' 个已标记" onclick="event.stopPropagation();SMTool._onIndicatorClick(' + node.id + ',\'bone\')" style="position:relative">🦴<span class="ndi-count">' + boneMarked + '</span></button>';
    }
    // 事件帧
    var eventCount = (node._eventFrames || []).length;
    if (eventCount > 0) {
        html += '<button class="ndi-btn ndi-event" title="事件帧: ' + eventCount + ' 个" onclick="event.stopPropagation();SMTool._onIndicatorClick(' + node.id + ',\'event\')" style="position:relative">⚡<span class="ndi-count">' + eventCount + '</span></button>';
    }
    // 插槽（仅当有标记内容时显示，角标为已标记数量）
    var slotMarked = 0;
    for (var sli = 0; sli < (node.slots || []).length; sli++) {
        var sln = node.slots[sli];
        if ((node._slotTags && node._slotTags[sln]) ||
            (node._slotNotes && node._slotNotes[sln] && node._slotNotes[sln].trim().length > 0) ||
            (node._slotScreenshots && node._slotScreenshots[sln] && (Array.isArray(node._slotScreenshots[sln]) ? node._slotScreenshots[sln].length > 0 : true))) {
            slotMarked++;
        }
    }
    if (slotMarked > 0) {
        html += '<button class="ndi-btn ndi-slot" title="插槽: ' + slotMarked + ' 个已标记" onclick="event.stopPropagation();SMTool._onIndicatorClick(' + node.id + ',\'slot\')" style="position:relative">🔲<span class="ndi-count">' + slotMarked + '</span></button>';
    }
    html += '</div>';
    return html;
};

// ★ 点击指示图标 → 选中节点 + 展开数据面板对应页签 + 5s 绝对自动收起
SMTool._onIndicatorClick = function (nid, tabName) {
    // 选中节点
    SMData.selectedNodes.clear();
    SMData.selectedNodes.add(nid);
    SMData.selectedNode = nid;
    SMTool._updateSel();
    // 展开数据面板（复用现有逻辑）
    SMTool._expandFloatPanel();
    // 强制刷新面板数据
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
    // 切换到对应页签
    SMTool._switchPanelTab(tabName);
    // ★ 指示器模式：5s 内忽略鼠标位移导致的收起，除非鼠标主动进入面板再退出
    SMData._floatPanel._indicatorMode = true;
    SMData._floatPanel._indicatorJustOpened = true;
    if (SMTool._indicatorAutoCloseTimer) clearTimeout(SMTool._indicatorAutoCloseTimer);
    SMTool._indicatorAutoCloseTimer = setTimeout(function () {
        SMData._floatPanel._indicatorMode = false;
        SMData._floatPanel._indicatorJustOpened = false;
        if (!SMData._floatPanel.hovered && !SMData._floatPanel.pinned) {
            SMTool._scheduleFloatPanelCollapse(null);
        }
    }, 5000);
};

// 构建轨道面板 HTML
SMTool._buildTrackPanelHtml = function (node) {
    // 确保有默认轨道
    if (!node.tracks || node.tracks.length === 0) {
        SMTool._initDefaultTracks(node);
    }

    var is4x = (node._spineVer === '4.3' || node._spineVer === '4.2');
    var MAX_TRACKS = 5;
    var html = '<div class="track-panel-header">' +
        '<span class="track-panel-title">🎬 轨道混合</span>' +
        (node.tracks.length < MAX_TRACKS
            ? '<button class="track-add-btn" onclick="event.stopPropagation();SMTool._addTrack(' + node.id + ')" title="添加轨道">+ 轨道</button>'
            : '') +
        '</div>';

    for (var ti = 0; ti < node.tracks.length; ti++) {
        var track = node.tracks[ti];
        var animOpts = '';
        for (var ai = 0; ai < node.animations.length; ai++) {
            var aa = node.animations[ai];
            var sel = (track.animName === aa.name) ? ' selected' : '';
            animOpts += '<option value="' + SMTool._esc(aa.name) + '"' + sel + '>' +
                SMTool._esc(aa.name) + ' (' + aa.duration.toFixed(2) + 's)</option>';
        }
        if (!animOpts) animOpts = '<option value="">-- 无动画 --</option>';

        var alphaPct = Math.round((track.alpha !== undefined ? track.alpha : 1.0) * 100);
        var isEnabled = track.enabled !== false;
        var checkedAttr = isEnabled ? ' checked' : '';

        // 混合模式选择器（仅 4.x 显示）
        var blendHtml = '';
        if (is4x) {
            var blends = ['replace', 'add', 'first', 'setup'];
            var blendLabels = { 'replace': '替换', 'add': '叠加', 'first': '首帧', 'setup': '初始' };
            blendHtml = '<select class="track-blend-select" onchange="event.stopPropagation();SMTool._onTrackBlendChange(' + node.id + ',' + ti + ',this.value)" title="混合模式">';
            for (var bi = 0; bi < blends.length; bi++) {
                var bv = blends[bi];
                var bsel = (track.mixBlend === bv || (!track.mixBlend && bv === 'replace')) ? ' selected' : '';
                blendHtml += '<option value="' + bv + '"' + bsel + '>' + (blendLabels[bv] || bv) + '</option>';
            }
            blendHtml += '</select>';
        }

        // 循环按钮 + 混合过渡时间
        var loopLabel = track.loop !== false ? '🔄' : '▶️';
        var loopTitle = track.loop !== false ? '循环中（点击切换为单次）' : '单次播放（点击切换为循环）';
        var mixDurVal = (track.mixDuration !== undefined ? track.mixDuration : 0);

        var disabledClass = isEnabled ? '' : ' track-disabled';

        html += '<div class="track-row' + disabledClass + '" data-track="' + ti + '">' +
            '<span class="track-label">T' + ti + '</span>' +
            '<select class="track-anim-select" onchange="event.stopPropagation();SMTool._onTrackAnimChange(' + node.id + ',' + ti + ',this.value)"' + (isEnabled ? '' : ' disabled') + '>' + animOpts + '</select>' +
            '<div class="track-alpha-wrap">' +
                '<input type="range" class="track-alpha-slider" min="0" max="100" value="' + alphaPct + '" oninput="event.stopPropagation();SMTool._onTrackAlphaChange(' + node.id + ',' + ti + ',this.value)" title="透明度">' +
                '<span class="track-alpha-val">' + alphaPct + '%</span>' +
            '</div>' +
            '<div class="track-mix-wrap" title="动画切换过渡时间（秒）">' +
                '<input type="number" class="track-mix-input" value="' + mixDurVal + '" min="0" max="5" step="0.1" ' +
                'onchange="event.stopPropagation();SMTool._onTrackMixDurationChange(' + node.id + ',' + ti + ',this.value)" ' +
                (isEnabled ? '' : 'disabled') + '>' +
                '<span class="track-mix-unit">s</span>' +
            '</div>' +
            blendHtml +
            '<button class="track-loop-btn' + (track.loop !== false ? ' active' : '') + '" ' +
                'onclick="event.stopPropagation();SMTool._onTrackLoopToggle(' + node.id + ',' + ti + ')" ' +
                'title="' + loopTitle + '">' + loopLabel + '</button>' +
            '<label class="track-enable" title="启用/禁用">' +
                '<input type="checkbox"' + checkedAttr + ' onchange="event.stopPropagation();SMTool._onTrackEnableToggle(' + node.id + ',' + ti + ',this.checked)">' +
            '</label>' +
            (ti > 0
                ? '<button class="track-delete-btn" onclick="event.stopPropagation();SMTool._removeTrack(' + node.id + ',' + ti + ')" title="删除轨道">✕</button>'
                : '<span class="track-delete-spacer"></span>') +
        '</div>';
    }
    return html;
};

// 刷新节点的轨道面板 DOM
SMTool._refreshTrackPanel = function (node) {
    var panel = document.getElementById('trackPanel-' + node.id);
    if (panel) {
        panel.innerHTML = SMTool._buildTrackPanelHtml(node);
    }
};

// 添加新轨道
SMTool._addTrack = function (nid) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    if (node.tracks.length >= 5) return;

    node.tracks.push({
        animName: node.animations[0] ? node.animations[0].name : '',
        alpha: 1.0,
        mixBlend: 'add',
        enabled: true,
        loop: true,
        mixDuration: 0
    });
    if (node.state) {
        SMTool._applyTracksToState(node);
    }
    SMTool._refreshTrackPanel(node);
};

// 删除轨道
SMTool._removeTrack = function (nid, trackIdx) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    if (trackIdx <= 0 || trackIdx >= node.tracks.length) return;

    node.tracks.splice(trackIdx, 1);
    if (node.state) {
        SMTool._applyTracksToState(node);
    }
    SMTool._refreshTrackPanel(node);
};

// 轨道动画切换（含混合过渡）
SMTool._onTrackAnimChange = function (nid, trackIdx, animName) {
    var node = SMData.nodes.get(nid);
    if (!node || !node.state) return;
    if (trackIdx < 0 || trackIdx >= node.tracks.length) return;

    var track = node.tracks[trackIdx];
    var oldAnim = track.animName;
    track.animName = animName;

    // 混合过渡时间：通过 AnimationStateData.setMix 实现 crossfade
    var mixDur = (track.mixDuration !== undefined && track.mixDuration > 0) ? track.mixDuration : 0;
    if (mixDur > 0 && oldAnim && oldAnim !== animName) {
        try { node.state.data.setMix(oldAnim, animName, mixDur); }
        catch (e) { try { node.state.data.defaultMix = mixDur; } catch (e2) {} }
    }

    if (trackIdx === 0) {
        node.currentAnim = animName;
        node.name = SMTool._translateName(animName);
        SMTool._updateEl(node);
    }
    SMTool._applyTracksToState(node);
    SMTool._updateStateRowColors();
    SMTool._updateDuplicateHighlights();
    // ★ 同步更新所有动画流路径中的状态名
    if (trackIdx === 0) {
        SMTool._syncFlowPathAnim(nid, animName);
        // ★ 同步更新浮窗预览动画
        var pp2 = SMData._animPreview;
        if (pp2 && pp2.visible && pp2.nodeId === nid) {
            SMTool._initAnimPreview(node);
        }
    }
};

// 轨道透明度变更
SMTool._onTrackAlphaChange = function (nid, trackIdx, value) {
    var node = SMData.nodes.get(nid);
    if (!node || !node.state) return;
    if (trackIdx < 0 || trackIdx >= node.tracks.length) return;

    var alpha = parseInt(value) / 100;
    node.tracks[trackIdx].alpha = alpha;

    // 实时更新 TrackEntry
    var entry = node.state.getCurrent(trackIdx);
    if (entry) {
        entry.alpha = alpha;
    }

    // 更新显示值
    var row = document.querySelector('#trackPanel-' + nid + ' .track-row[data-track="' + trackIdx + '"]');
    if (row) {
        var valEl = row.querySelector('.track-alpha-val');
        if (valEl) valEl.textContent = Math.round(alpha * 100) + '%';
    }
};

// 轨道混合模式变更
SMTool._onTrackBlendChange = function (nid, trackIdx, blendMode) {
    var node = SMData.nodes.get(nid);
    if (!node || !node.state) return;
    if (trackIdx < 0 || trackIdx >= node.tracks.length) return;

    node.tracks[trackIdx].mixBlend = blendMode;

    var is4x = (node._spineVer === '4.3' || node._spineVer === '4.2');
    if (is4x) {
        var entry = node.state.getCurrent(trackIdx);
        if (entry) {
            entry.mixBlend = SMTool._mixBlendValue(blendMode);
        }
    }
};

// 轨道启用/禁用切换
SMTool._onTrackEnableToggle = function (nid, trackIdx, checked) {
    var node = SMData.nodes.get(nid);
    if (!node || !node.state) return;
    if (trackIdx < 0 || trackIdx >= node.tracks.length) return;

    node.tracks[trackIdx].enabled = checked;
    SMTool._applyTracksToState(node);
    // 刷新面板以更新 disabled 样式
    SMTool._refreshTrackPanel(node);
};

// 轨道循环/单次切换
SMTool._onTrackLoopToggle = function (nid, trackIdx) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    if (trackIdx < 0 || trackIdx >= node.tracks.length) return;

    node.tracks[trackIdx].loop = !(node.tracks[trackIdx].loop !== false);
    var newLoop = node.tracks[trackIdx].loop;
    if (trackIdx === 0) node.loop = newLoop;

    if (node.state) {
        var entry = node.state.getCurrent(trackIdx);
        if (entry) entry.loop = newLoop;
    }
    var row = document.querySelector('#trackPanel-' + nid + ' .track-row[data-track="' + trackIdx + '"]');
    if (row) {
        var btn = row.querySelector('.track-loop-btn');
        if (btn) {
            btn.textContent = newLoop ? '🔄' : '▶️';
            btn.classList.toggle('active', newLoop);
            btn.title = newLoop ? '循环中（点击切换为单次）' : '单次播放（点击切换为循环）';
        }
    }
    if (trackIdx === 0) {
        var gb = document.querySelector('#sn-' + nid + ' .loop-toggle');
        if (gb) { gb.textContent = newLoop ? '🔄 循环播放' : '▶ 单次播放'; gb.classList.toggle('active', newLoop); }
    }
};

// 轨道混合过渡时间变更
SMTool._onTrackMixDurationChange = function (nid, trackIdx, value) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    if (trackIdx < 0 || trackIdx >= node.tracks.length) return;

    var d = parseFloat(value);
    if (isNaN(d) || d < 0) d = 0;
    if (d > 5) d = 5;
    node.tracks[trackIdx].mixDuration = d;

    var row = document.querySelector('#trackPanel-' + nid + ' .track-row[data-track="' + trackIdx + '"]');
    if (row) {
        var inp = row.querySelector('.track-mix-input');
        if (inp && parseFloat(inp.value) !== d) inp.value = d;
    }
};

SMTool._updateTextNode = function (nid, value) {
    var node = SMData.nodes.get(nid);
    if (node) node._textContent = value;
};
SMTool._updateTextNodeName = function (nid, value) {
    var node = SMData.nodes.get(nid);
    if (node) node.name = value;
};
SMTool._updateExitText = function (nid, value) {
    var node = SMData.nodes.get(nid);
    if (node) node._exitText = value;
};

// ---- 延时器数值操作 ----
SMTool._delayerStep = function (nid, delta) {
    var node = SMData.nodes.get(nid);
    if (!node || node.nodeType !== 'delayer') return;
    var val = (node._delayValue || 1.0) + delta;
    if (val < 0.001) val = 0.001;
    node._delayValue = Math.round(val * 1000) / 1000;
    var el = SMTool._getEl(nid);
    if (el) {
        var inp = el.querySelector('.delayer-input');
        if (inp) inp.value = node._delayValue;
    }
};

SMTool._delayerSet = function (nid, val) {
    var node = SMData.nodes.get(nid);
    if (!node || node.nodeType !== 'delayer') return;
    if (isNaN(val) || val < 0.001) val = 0.001;
    node._delayValue = Math.round(val * 1000) / 1000;
    var el = SMTool._getEl(nid);
    if (el) {
        var inp = el.querySelector('.delayer-input');
        if (inp) inp.value = node._delayValue;
    }
};

// ---- 循环/单次切换 ----
SMTool._toggleLoop = function (nid) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    node.loop = !node.loop;
    // 同步到 track 0
    if (!node.tracks || node.tracks.length === 0) {
        SMTool._initDefaultTracks(node);
    }
    node.tracks[0].loop = node.loop;
    if (node.state) {
        SMTool._applyTracksToState(node);
    }
    var btn = document.querySelector('#sn-' + nid + ' .loop-toggle');
    if (btn) {
        btn.textContent = node.loop ? '🔄 循环播放' : '▶ 单次播放';
        btn.classList.toggle('active', node.loop);
    }
    // ★ 同步底部栏状态
    SMTool._updateBottomBar();
};

// ---- 状态描述更新 ----
SMTool._updateStateDesc = function (nid, value) {
    var node = SMData.nodes.get(nid);
    if (node) node._stateDesc = value;
    var ta = document.querySelector('#sn-' + nid + ' .state-desc');
    if (ta) {
        // ★ 自动撑开：先缩到 0 触发 scrollHeight 重算，再设为目标高度，CSS min-height:96px 兜底
        ta.style.height = '0px';
        ta.style.height = ta.scrollHeight + 'px';
        // ★ 有内容时文字变黄色
        if (value && value.trim().length > 0) ta.classList.add('has-content');
        else ta.classList.remove('has-content');
        // ★ textarea 高度变化后刷新节点位置，确保连线端点跟随
        if (node) SMTool._updatePos(node);
    }
};

// ---- 构建骨骼行 HTML（含备注区和截图区）----
SMTool._buildBoneRowHtml = function (node, boneName) {
    var taggedStates = (node._boneTags && node._boneTags[boneName]) ? node._boneTags[boneName].join(', ') : '';
    var taggedHtml = taggedStates ? '<span class="dfp-bone-tagged">' + SMTool._esc(taggedStates) + '</span>' : '';

    var isMarked = !!(node._boneTags && node._boneTags[boneName]);
    var shots = (node._boneScreenshots && node._boneScreenshots[boneName]) ? node._boneScreenshots[boneName] : [];
    if (!Array.isArray(shots)) shots = shots ? [shots] : [];
    var noteText = (node._boneNotes && node._boneNotes[boneName]) ? (node._boneNotes[boneName]) : '';

    // ★ 收起来时的预览信息
    var fadeDataPreview = (node._boneFade && node._boneFade[boneName]) || { enabled: false, duration: 1.0 };
    var previewBadges = '';
    if (shots.length > 0) {
        previewBadges += '<span class="dfp-bone-badge" title="' + shots.length + ' 张截图">📷' + shots.length + '</span>';
    }
    if (noteText.trim().length > 0) {
        previewBadges += '<span class="dfp-bone-badge" title="有备注">📝</span>';
    }
    if (fadeDataPreview.enabled) {
        previewBadges += '<span class="dfp-bone-badge dfp-bone-fade-badge" title="透明度淡入淡出: ' + fadeDataPreview.duration + 's">✨</span>';
    }

    // ★ 标记按钮：有内容或已标记时显示红色，空骨骼显示灰色
    var hasContent = (shots.length > 0 || noteText.trim().length > 0);
    var markClass = 'dfp-bone-mark';
    if (isMarked) {
        markClass += ' active';
    } else if (hasContent) {
        markClass += ' has-content';
    }

    var html = '<div class="dfp-row dfp-bone-row' + (isMarked ? ' expanded' : '') + '" data-bone="' + SMTool._esc(boneName) + '" onclick="SMTool._toggleBoneTag(\'' + SMTool._esc(boneName) + '\')" style="cursor:pointer">' +
        '<span class="dfp-bone-name">' + SMTool._esc(boneName) + previewBadges + '</span>' +
        '<span class="dfp-bone-right">' + taggedHtml;
        if (isMarked) html += '<button class="dfp-clear-mark-btn" onclick="event.stopPropagation();SMTool._clearMarkedItem(\'' + SMTool._esc(boneName) + '\',\'bone\')" title="清除此骨骼的全部标记数据（截图/备注/淡入淡出）">取消标记</button>';
        html += '</span>' +
        '<span class="' + markClass + '" data-bone="' + SMTool._esc(boneName) + '" onclick="event.stopPropagation();SMTool._toggleBoneTag(\'' + SMTool._esc(boneName) + '\')" title="' + (isMarked ? '取消标记' : '标记骨骼（展开备注和截图）') + '">+</span>' +
        '</div>';

    if (isMarked) {
        var noteTextEsc = SMTool._esc(noteText);
        // shots 已在上面声明，确保是数组
        if (!Array.isArray(shots)) shots = shots ? [shots] : [];

        // ★ 透明度淡入淡出控件
        var fadeData = (node._boneFade && node._boneFade[boneName]) || { enabled: false, duration: 1.0 };
        var fadeChecked = fadeData.enabled ? ' checked' : '';
        var fadeDur = fadeData.duration || 1.0;
        html += '<div class="dfp-fade-row">' +
            '<label class="dfp-fade-label">' +
                '<input type="checkbox" class="dfp-fade-check" ' + fadeChecked + ' onchange="SMTool._toggleBoneFade(\'' + SMTool._esc(boneName) + '\', this.checked)">' +
                '透明度淡入淡出' +
            '</label>' +
            '<span class="dfp-fade-input-wrap' + (fadeData.enabled ? '' : ' hidden') + '">' +
                '<span class="dfp-fade-wrap">' +
                    '<button class="dfp-fade-btn" onclick="SMTool._fadeStepInput(this,-1)" title="减少">◀</button>' +
                    '<input type="number" class="dfp-fade-dur" value="' + fadeDur + '" min="0.1" max="60" step="0.1" onchange="SMTool._setBoneFadeDur(\'' + SMTool._esc(boneName) + '\', parseFloat(this.value)||1.0)">' +
                    '<button class="dfp-fade-btn" onclick="SMTool._fadeStepInput(this,1)" title="增加">▶</button>' +
                '</span>' +
                '<span class="dfp-fade-unit">S</span>' +
            '</span>' +
        '</div>';

        var shotsHtml = '';
        for (var si = 0; si < shots.length; si++) {
            var shotVal = shots[si];
            // - 新格式（shotId 数字）：优先使用预生成的缩略图，降级为原图，极端情况才用 SVG 占位符
            // - 旧格式（dataUrl 字符串）：直接显示（兼容已保存的旧项目）
            var isNewFormat = (typeof shotVal === 'number');
            if (isNewFormat) {
                var shotSrc = SMData._shotGetThumb(shotVal);
                if (!shotSrc) {
                    shotSrc = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="0 0 128 96"><rect fill="%232a2a35" width="128" height="96"/><text fill="%23666" x="64" y="52" text-anchor="middle" font-size="12">📷 ' + (si + 1) + '</text></svg>');
                }
                // ★ 挂载状态：默认挂载，点击可取消/恢复
                var isMounted = !(node._boneShotMounted && node._boneShotMounted[boneName] && node._boneShotMounted[boneName][si] === false);
                var mountClass = isMounted ? 'dfp-shot-mount' : 'dfp-shot-mount active';
                var mountText = isMounted ? '取消挂点' : '挂点';
                shotsHtml += '<div class="dfp-shot-item">' +
                    '<button class="' + mountClass + '" onclick="event.stopPropagation();SMTool._toggleBoneShotMount(\'' + SMTool._esc(boneName) + '\',' + si + ')">' + mountText + '</button>' +
                    '<img src="' + shotSrc + '" alt="截图' + (si + 1) + '" onclick="event.stopPropagation();SMTool._openScreenshot(\'' + SMTool._esc(boneName) + '\',' + si + ')">' +
                    '<span class="dfp-shot-del" onclick="event.stopPropagation();SMTool._removeBoneScreenshot(\'' + SMTool._esc(boneName) + '\',' + si + ')" title="删除此截图">×</span>' +
                '</div>';
            } else {
                // 旧格式兼容：直接用 dataUrl（已由调用方注册到全局表后的降级路径）
                shotsHtml += '<div class="dfp-shot-item" onclick="event.stopPropagation();SMTool._openScreenshot(\'' + SMTool._esc(boneName) + '\',' + si + ')">' +
                    '<img src="' + shotVal + '" alt="截图' + (si + 1) + '" loading="lazy">' +
                    '<span class="dfp-shot-del" onclick="event.stopPropagation();SMTool._removeBoneScreenshot(\'' + SMTool._esc(boneName) + '\',' + si + ')" title="删除此截图">×</span>' +
                '</div>';
            }
        }
        html += '<div class="dfp-bone-note-area show" data-bone-note="' + SMTool._esc(boneName) + '">' +
            '<textarea placeholder="骨骼备注..." oninput="SMTool._updateBoneNote(\'' + SMTool._esc(boneName) + '\', this.value)" onclick="event.stopPropagation()">' + noteTextEsc + '</textarea>' +
            '<div class="dfp-bone-shot-area show">' +
                '<div class="dfp-shot-list">' + shotsHtml + '</div>' +
                '<div class="dfp-shot-actions">' +
                    '<button class="dfp-shot-add" onclick="event.stopPropagation();SMTool._pickScreenshot(\'' + SMTool._esc(boneName) + '\')" ondragover="event.preventDefault();event.stopPropagation()" ondrop="event.preventDefault();event.stopPropagation();SMTool._dropScreenshot(event,\'' + SMTool._esc(boneName) + '\')" title="选取图片 / 拖入图片">📁 选取图片</button>' +
                    '<button class="dfp-shot-add dfp-shot-btn-paste" onclick="event.stopPropagation();SMTool._pasteScreenshot(\'' + SMTool._esc(boneName) + '\',\'bone\')" title="先点此按钮，再按 Ctrl+V 粘贴剪贴板截图">📋 粘贴截图</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }
    return html;
};

// ================================================================
// 🔒🔒🔒 [LOCK-I] 皮肤行 HTML 构建（备注/截图/淡入淡出）
// ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
//    如需修改，一定要寻求同意"解锁"才可以。
// 与骨骼行结构一致，但截图无挂载/取消挂载按钮。
// ================================================================
SMTool._buildSkinRowHtml = function (node, skinName) {
    var isMarked = !!(node._skinTags && node._skinTags[skinName]);
    var isCurrentSkin = (node.currentSkin === skinName) ||
        (!node.currentSkin && node.skeletonData && node.skeletonData.defaultSkin && node.skeletonData.defaultSkin.name === skinName);
    var shots = (node._skinScreenshots && node._skinScreenshots[skinName]) ? node._skinScreenshots[skinName] : [];
    if (!Array.isArray(shots)) shots = shots ? [shots] : [];
    var noteText = (node._skinNotes && node._skinNotes[skinName]) ? (node._skinNotes[skinName]) : '';

    // ★ 皮肤无淡入淡出
    var previewBadges = '';
    if (shots.length > 0) {
        previewBadges += '<span class="dfp-bone-badge" title="' + shots.length + ' 张截图">📷' + shots.length + '</span>';
    }
    if (noteText.trim().length > 0) {
        previewBadges += '<span class="dfp-bone-badge" title="有备注">📝</span>';
    }
    if (isCurrentSkin) {
        previewBadges += '<span class="dfp-bone-badge" style="background:#ff6699;color:#fff" title="当前皮肤">✓</span>';
    }

    var hasContent = (shots.length > 0 || noteText.trim().length > 0);
    var markClass = 'dfp-bone-mark';
    if (isMarked) {
        markClass += ' active';
    } else if (hasContent) {
        markClass += ' has-content';
    }

    var html = '<div class="dfp-row dfp-bone-row' + (isMarked ? ' expanded' : '') + (isCurrentSkin ? ' skin-current' : '') + '" data-bone="' + SMTool._esc(skinName) + '" onclick="SMTool._setSkin(' + node.id + ',\'' + SMTool._escAttr(skinName) + '\')" style="cursor:pointer" title="点击切换到此皮肤">' +
        '<span class="dfp-bone-name">' + SMTool._esc(skinName) + previewBadges + '</span>' +
        '<span class="dfp-bone-right">' + (isMarked ? '<button class="dfp-clear-mark-btn" onclick="event.stopPropagation();SMTool._clearMarkedItem(\'' + SMTool._esc(skinName) + '\',\'skin\')" title="清除此皮肤的全部标记数据">取消标记</button>' : '') + '</span>' +
        '<span class="' + markClass + '" data-bone="' + SMTool._esc(skinName) + '" onclick="event.stopPropagation();SMTool._toggleSkinTag(\'' + SMTool._esc(skinName) + '\')" title="' + (isMarked ? '取消标记' : '标记皮肤（展开备注和截图）') + '">+</span>' +
        '</div>';

    if (isMarked) {
        var noteTextEsc = SMTool._esc(noteText);
        if (!Array.isArray(shots)) shots = shots ? [shots] : [];

        // ★ 皮肤无淡入淡出（仅骨骼有）

        var shotsHtml = '';
        for (var si = 0; si < shots.length; si++) {
            var shotVal = shots[si];
            var isNewFormat = (typeof shotVal === 'number');
            if (isNewFormat) {
                var shotSrc = SMData._shotGetThumb(shotVal);
                if (!shotSrc) {
                    shotSrc = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="0 0 128 96"><rect fill="%232a2a35" width="128" height="96"/><text fill="%23666" x="64" y="52" text-anchor="middle" font-size="12">📷 ' + (si + 1) + '</text></svg>');
                }
                // ★ 皮肤截图无挂载按钮
                shotsHtml += '<div class="dfp-shot-item">' +
                    '<img src="' + shotSrc + '" alt="截图' + (si + 1) + '" onclick="event.stopPropagation();SMTool._openSkinScreenshot(\'' + SMTool._esc(skinName) + '\',' + si + ')">' +
                    '<span class="dfp-shot-del" onclick="event.stopPropagation();SMTool._removeSkinScreenshot(\'' + SMTool._esc(skinName) + '\',' + si + ')" title="删除此截图">×</span>' +
                '</div>';
            } else {
                shotsHtml += '<div class="dfp-shot-item" onclick="event.stopPropagation();SMTool._openSkinScreenshot(\'' + SMTool._esc(skinName) + '\',' + si + ')">' +
                    '<img src="' + shotVal + '" alt="截图' + (si + 1) + '" loading="lazy">' +
                    '<span class="dfp-shot-del" onclick="event.stopPropagation();SMTool._removeSkinScreenshot(\'' + SMTool._esc(skinName) + '\',' + si + ')" title="删除此截图">×</span>' +
                '</div>';
            }
        }
        html += '<div class="dfp-bone-note-area show" data-bone-note="' + SMTool._esc(skinName) + '">' +
            '<textarea placeholder="皮肤备注..." oninput="SMTool._updateSkinNote(\'' + SMTool._esc(skinName) + '\', this.value)" onclick="event.stopPropagation()">' + noteTextEsc + '</textarea>' +
            '<div class="dfp-bone-shot-area show">' +
                '<div class="dfp-shot-list">' + shotsHtml + '</div>' +
                '<div class="dfp-shot-actions">' +
                    '<button class="dfp-shot-add" onclick="event.stopPropagation();SMTool._pickSkinScreenshot(\'' + SMTool._esc(skinName) + '\')" ondragover="event.preventDefault();event.stopPropagation()" ondrop="event.preventDefault();event.stopPropagation();SMTool._dropSkinScreenshot(event,\'' + SMTool._esc(skinName) + '\')" title="选取图片 / 拖入图片">📁 选取图片</button>' +
                    '<button class="dfp-shot-add dfp-shot-btn-paste" onclick="event.stopPropagation();SMTool._pasteScreenshot(\'' + SMTool._esc(skinName) + '\',\'skin\')" title="先点此按钮，再按 Ctrl+V 粘贴剪贴板截图">📋 粘贴截图</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }
    return html;
};
// 🔒 [LOCK-I] END

// ================================================================
// 🔒🔒🔒 [LOCK-J] 插槽行 HTML 构建（备注/截图/淡入淡出）
// ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
//    如需修改，一定要寻求同意"解锁"才可以。
// ================================================================
SMTool._buildSlotRowHtml = function (node, slotName) {
    var isMarked = !!(node._slotTags && node._slotTags[slotName]);
    var shots = (node._slotScreenshots && node._slotScreenshots[slotName]) ? node._slotScreenshots[slotName] : [];
    if (!Array.isArray(shots)) shots = shots ? [shots] : [];
    var noteText = (node._slotNotes && node._slotNotes[slotName]) ? (node._slotNotes[slotName]) : '';

    // ★ 插槽无淡入淡出
    var previewBadges = '';
    if (shots.length > 0) {
        previewBadges += '<span class="dfp-bone-badge" title="' + shots.length + ' 张截图">📷' + shots.length + '</span>';
    }
    if (noteText.trim().length > 0) {
        previewBadges += '<span class="dfp-bone-badge" title="有备注">📝</span>';
    }

    var hasContent = (shots.length > 0 || noteText.trim().length > 0);
    var markClass = 'dfp-bone-mark';
    if (isMarked) {
        markClass += ' active';
    } else if (hasContent) {
        markClass += ' has-content';
    }

    var html = '<div class="dfp-row dfp-bone-row' + (isMarked ? ' expanded' : '') + '" data-bone="' + SMTool._esc(slotName) + '" onclick="SMTool._toggleSlotTag(\'' + SMTool._esc(slotName) + '\')" style="cursor:pointer">' +
        '<span class="dfp-bone-name">' + SMTool._esc(slotName) + previewBadges + '</span>' +
        '<span class="dfp-bone-right">' + (isMarked ? '<button class="dfp-clear-mark-btn" onclick="event.stopPropagation();SMTool._clearMarkedItem(\'' + SMTool._esc(slotName) + '\',\'slot\')" title="清除此插槽的全部标记数据">取消标记</button>' : '') + '</span>' +
        '<span class="' + markClass + '" data-bone="' + SMTool._esc(slotName) + '" onclick="event.stopPropagation();SMTool._toggleSlotTag(\'' + SMTool._esc(slotName) + '\')" title="' + (isMarked ? '取消标记' : '标记插槽（展开备注和截图）') + '">+</span>' +
        '</div>';

    if (isMarked) {
        var noteTextEsc = SMTool._esc(noteText);
        if (!Array.isArray(shots)) shots = shots ? [shots] : [];

        // ★ 插槽无淡入淡出（仅骨骼有）

        var shotsHtml = '';
        for (var si = 0; si < shots.length; si++) {
            var shotVal = shots[si];
            var isNewFormat = (typeof shotVal === 'number');
            if (isNewFormat) {
                var shotSrc = SMData._shotGetThumb(shotVal);
                if (!shotSrc) {
                    shotSrc = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="0 0 128 96"><rect fill="%232a2a35" width="128" height="96"/><text fill="%23666" x="64" y="52" text-anchor="middle" font-size="12">📷 ' + (si + 1) + '</text></svg>');
                }
                // ★ 插槽截图无挂载按钮
                shotsHtml += '<div class="dfp-shot-item">' +
                    '<img src="' + shotSrc + '" alt="截图' + (si + 1) + '" onclick="event.stopPropagation();SMTool._openSlotScreenshot(\'' + SMTool._esc(slotName) + '\',' + si + ')">' +
                    '<span class="dfp-shot-del" onclick="event.stopPropagation();SMTool._removeSlotScreenshot(\'' + SMTool._esc(slotName) + '\',' + si + ')" title="删除此截图">×</span>' +
                '</div>';
            } else {
                shotsHtml += '<div class="dfp-shot-item" onclick="event.stopPropagation();SMTool._openSlotScreenshot(\'' + SMTool._esc(slotName) + '\',' + si + ')">' +
                    '<img src="' + shotVal + '" alt="截图' + (si + 1) + '" loading="lazy">' +
                    '<span class="dfp-shot-del" onclick="event.stopPropagation();SMTool._removeSlotScreenshot(\'' + SMTool._esc(slotName) + '\',' + si + ')" title="删除此截图">×</span>' +
                '</div>';
            }
        }
        html += '<div class="dfp-bone-note-area show" data-bone-note="' + SMTool._esc(slotName) + '">' +
            '<textarea placeholder="插槽备注..." oninput="SMTool._updateSlotNote(\'' + SMTool._esc(slotName) + '\', this.value)" onclick="event.stopPropagation()">' + noteTextEsc + '</textarea>' +
            '<div class="dfp-bone-shot-area show">' +
                '<div class="dfp-shot-list">' + shotsHtml + '</div>' +
                '<div class="dfp-shot-actions">' +
                    '<button class="dfp-shot-add" onclick="event.stopPropagation();SMTool._pickSlotScreenshot(\'' + SMTool._esc(slotName) + '\')" ondragover="event.preventDefault();event.stopPropagation()" ondrop="event.preventDefault();event.stopPropagation();SMTool._dropSlotScreenshot(event,\'' + SMTool._esc(slotName) + '\')" title="选取图片 / 拖入图片">📁 选取图片</button>' +
                    '<button class="dfp-shot-add dfp-shot-btn-paste" onclick="event.stopPropagation();SMTool._pasteScreenshot(\'' + SMTool._esc(slotName) + '\',\'slot\')" title="先点此按钮，再按 Ctrl+V 粘贴剪贴板截图">📋 粘贴截图</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }
    return html;
};
// 🔒 [LOCK-J] END

// ★ 判断节点骨骼页签是否有任何内容（标记/备注/截图/淡入淡出）
SMTool._hasBoneContent = function (node) {
    if (!node || !node.bones) return false;
    for (var i = 0; i < node.bones.length; i++) {
        var bn = node.bones[i];
        if (node._boneTags && node._boneTags[bn]) return true;
        if (node._boneNotes && node._boneNotes[bn] && node._boneNotes[bn].trim().length > 0) return true;
        if (node._boneScreenshots && node._boneScreenshots[bn]) {
            var ss = node._boneScreenshots[bn];
            if (Array.isArray(ss) && ss.length > 0) return true;
            if (ss && !Array.isArray(ss)) return true;
        }
        if (node._boneFade && node._boneFade[bn] && node._boneFade[bn].enabled) return true;
    }
    return false;
};

// ★ 判断节点皮肤页签是否有任何内容（标记/备注/截图，不含淡入淡出）
SMTool._hasSkinContent = function (node) {
    if (!node || !node.skins) return false;
    for (var i = 0; i < node.skins.length; i++) {
        var sn = node.skins[i];
        if (node._skinTags && node._skinTags[sn]) return true;
        if (node._skinNotes && node._skinNotes[sn] && node._skinNotes[sn].trim().length > 0) return true;
        if (node._skinScreenshots && node._skinScreenshots[sn]) {
            var ss = node._skinScreenshots[sn];
            if (Array.isArray(ss) && ss.length > 0) return true;
            if (ss && !Array.isArray(ss)) return true;
        }
    }
    return false;
};

// ★ 判断节点插槽页签是否有任何内容（标记/备注/截图，不含淡入淡出）
SMTool._hasSlotContent = function (node) {
    if (!node || !node.slots) return false;
    for (var i = 0; i < node.slots.length; i++) {
        var sn = node.slots[i];
        if (node._slotTags && node._slotTags[sn]) return true;
        if (node._slotNotes && node._slotNotes[sn] && node._slotNotes[sn].trim().length > 0) return true;
        if (node._slotScreenshots && node._slotScreenshots[sn]) {
            var ss = node._slotScreenshots[sn];
            if (Array.isArray(ss) && ss.length > 0) return true;
            if (ss && !Array.isArray(ss)) return true;
        }
    }
    return false;
};

// ★ 判断当前动画是否有事件帧（用于页签红点）
SMTool._hasEventContent = function (node) {
    if (!node || !node.skeletonData) return false;
    var animName = node.currentAnim || (node.animations.length > 0 ? node.animations[0].name : '');
    if (!animName) return false;
    var sd = node.skeletonData;
    for (var ai = 0; ai < sd.animations.length; ai++) {
        if (sd.animations[ai].name !== animName) continue;
        var timelines = sd.animations[ai].timelines || (typeof sd.animations[ai].getTimelines === 'function' ? sd.animations[ai].getTimelines() : []);
        for (var ti = 0; ti < timelines.length; ti++) {
            if (timelines[ti].events && timelines[ti].events.length > 0) return true;
        }
    }
    // 也检查是否已有事件备注或截图
    if (node._eventNotes && Object.keys(node._eventNotes).length > 0) return true;
    if (node._eventScreenshots && Object.keys(node._eventScreenshots).length > 0) return true;
    return false;
};

// ================================================================
// ★ 事件帧辅助函数 — 备注 / 截图 / 展开收起
// ================================================================

SMTool._toggleEventExpand = function (eventName) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    if (!node._eventExpanded) node._eventExpanded = {};
    node._eventExpanded[eventName] = !node._eventExpanded[eventName];
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
};

SMTool._updateEventNote = function (eventName, value) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._eventNotes) n._eventNotes = {};
        n._eventNotes[eventName] = value;
    }
};

SMTool._pickEventScreenshot = function (eventName) {
    SMData._pasteTargetBone = eventName;  // 复用粘贴目标
    SMData._pasteTargetType = 'event';
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = function () {
        var files = input.files;
        if (!files || files.length === 0) return;
        var loaded = 0;
        var dataUrls = [];
        for (var i = 0; i < files.length; i++) {
            (function (file) {
                var reader = new FileReader();
                reader.onload = function () {
                    dataUrls.push(reader.result);
                    loaded++;
                    if (loaded === files.length) SMTool._addEventScreenshots(eventName, dataUrls);
                };
                reader.readAsDataURL(file);
            })(files[i]);
        }
    };
    input.click();
};

SMTool._dropEventScreenshot = function (e, eventName) {
    var files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    var loaded = 0;
    var dataUrls = [];
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!file.type.startsWith('image/')) continue;
        (function (f) {
            var reader = new FileReader();
            reader.onload = function () {
                dataUrls.push(reader.result);
                loaded++;
                if (loaded === files.length) SMTool._addEventScreenshots(eventName, dataUrls);
            };
            reader.readAsDataURL(f);
        })(file);
    }
};

SMTool._addEventScreenshots = function (eventName, dataUrls) {
    SMTool._addScreenshots(eventName, dataUrls, 'event');
};

SMTool._removeEventScreenshot = function (eventName, index) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node || !node._eventScreenshots || !node._eventScreenshots[eventName]) return;
    var shotId = node._eventScreenshots[eventName][index];
    if (typeof shotId === 'number') { SMData._shotRelease(shotId); }
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var ni = 0; ni < sameSourceNodes.length; ni++) {
        var sn = sameSourceNodes[ni];
        if (sn._eventScreenshots && sn._eventScreenshots[eventName]) {
            sn._eventScreenshots[eventName].splice(index, 1);
            if (sn._eventScreenshots[eventName].length === 0) delete sn._eventScreenshots[eventName];
        }
    }
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
};

// ---- 骨骼标记 ----
// ================================================================
// ★ 获取与指定节点共享同一源文件且已被选中的节点（含自身）
//    仅多选（≥2 个节点）时同步，单选时只返回自身
// ================================================================
SMTool._getSameSourceNodes = function (node) {
    if (!node || !node.sourceFile) return [node];
    // 单选 → 只操作当前节点，不同步
    if (SMData.selectedNodes.size <= 1) return [node];
    var sf = node.sourceFile;
    var sameNodes = [];
    SMData.selectedNodes.forEach(function (nid) {
        var n = SMData.nodes.get(nid);
        if (n && n.sourceFile === sf && n.nodeType === 'spine') {
            sameNodes.push(n);
        }
    });
    return sameNodes.length > 0 ? sameNodes : [node];
};

SMTool._toggleBoneTag = function (boneName, type) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node || node.nodeType !== 'spine') return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    type = type || 'bone';  // 'bone' 或 'slot'
    var tagKey = type === 'slot' ? '_slotTags' : '_boneTags';
    var newState = !(node[tagKey] && node[tagKey][boneName]);
    // ★ 标记从灰变红时自动设为粘贴目标
    if (newState) {
        SMData._pasteTargetBone = boneName;
        SMData._pasteTargetType = type;
    }
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n[tagKey]) n[tagKey] = {};
        if (newState) {
            n[tagKey][boneName] = [];
        } else {
            delete n[tagKey][boneName];
        }
        SMTool._refreshBoneTagsUI(n);
        var nEl = SMTool._getEl(n.id);
        if (nEl) {
            var indEl = nEl.querySelector('.node-indicators');
            if (indEl) indEl.outerHTML = SMTool._buildNodeIndicatorsHtml(n);
        }
    }
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
};

// ★ 完全清除标记项（支持多选）
SMTool._clearMarkedItem = function (name, type) {
    type = type || 'bone';
    var processed = {};  // 防止同源节点重复处理
    var selIds = [];
    SMData.selectedNodes.forEach(function (nid) { selIds.push(nid); });
    if (selIds.length === 0 && SMData.selectedNode) selIds.push(SMData.selectedNode);
    for (var si = 0; si < selIds.length; si++) {
        var node = SMData.nodes.get(selIds[si]);
        if (!node || node.nodeType !== 'spine') continue;
        var sameSourceNodes = SMTool._getSameSourceNodes(node);
        for (var ni = 0; ni < sameSourceNodes.length; ni++) {
            var n = sameSourceNodes[ni];
            if (processed[n.id]) continue;
            processed[n.id] = true;
            var tagKey = (type === 'slot' ? '_slotTags' : type === 'skin' ? '_skinTags' : '_boneTags');
            if (n[tagKey]) delete n[tagKey][name];
            var noteKey = (type === 'slot' ? '_slotNotes' : type === 'skin' ? '_skinNotes' : '_boneNotes');
            if (n[noteKey]) delete n[noteKey][name];
            var shotKey = (type === 'slot' ? '_slotScreenshots' : type === 'skin' ? '_skinScreenshots' : '_boneScreenshots');
            if (n[shotKey] && n[shotKey][name]) {
                var shots = n[shotKey][name];
                if (!Array.isArray(shots)) shots = [shots];
                for (var sj = 0; sj < shots.length; sj++) {
                    if (typeof shots[sj] === 'number') SMData._shotRelease(shots[sj]);
                }
                delete n[shotKey][name];
            }
            var refKey = (type === 'slot' ? '_slotShotRefs' : type === 'skin' ? '_skinShotRefs' : '_boneShotRefs');
            if (n[refKey]) delete n[refKey][name];
            if (type === 'bone' && n._boneFade) delete n._boneFade[name];
            SMTool._refreshBoneTagsUI(n);
            var nEl = SMTool._getEl(n.id);
            if (nEl) {
                var indEl = nEl.querySelector('.node-indicators');
                if (indEl) indEl.outerHTML = SMTool._buildNodeIndicatorsHtml(n);
            }
        }
    }
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
};

SMTool._addBoneTagState = function (nid, boneName, stateName) {
    var node = SMData.nodes.get(nid);
    if (!node || !node._boneTags || !node._boneTags[boneName]) return;
    if (node._boneTags[boneName].indexOf(stateName) < 0) {
        node._boneTags[boneName].push(stateName);
        SMTool._refreshBoneTagsUI(node);
        SMData._lastPanelNodeId = -1;
        SMTool._updateFloatPanel();
    }
};

SMTool._refreshBoneTagsUI = function (node) {
    var el = document.getElementById('boneTags-' + node.id);
    if (!el) return;
    if (!node._boneTags || Object.keys(node._boneTags).length === 0) {
        el.innerHTML = '';
        return;
    }
    var html = '<span class="bone-tag-title">挂点</span>';
    var bones = Object.keys(node._boneTags);
    for (var b = 0; b < bones.length; b++) {
        var bn = bones[b];
        var states = node._boneTags[bn] || [];
        html += '<div class="bone-tag-capsule">' +
            '<span class="bone-tag-name">' + SMTool._esc(bn) + '</span>';
        for (var s = 0; s < states.length; s++) {
            html += '<div class="bone-tag-state-capsule">' + SMTool._esc(states[s]) + '</div>';
        }
        html += '</div>';
    }
    el.innerHTML = html;
};

// ---- 骨骼备注更新 ----
SMTool._updateBoneNote = function (boneName, value) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._boneNotes) n._boneNotes = {};
        n._boneNotes[boneName] = value;
    }
};

// ---- 骨骼淡入淡出开关 ----
SMTool._toggleBoneFade = function (boneName, enabled) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._boneFade) n._boneFade = {};
        if (!n._boneFade[boneName]) n._boneFade[boneName] = { enabled: false, duration: 1.0 };
        n._boneFade[boneName].enabled = enabled;
    }
    // 显示/隐藏数值框
    var wrap = document.querySelector('.dfp-bone-note-area[data-bone-note="' + boneName + '"]');
    if (wrap) {
        var inputWrap = wrap.parentElement.querySelector('.dfp-fade-input-wrap');
        if (inputWrap) {
            inputWrap.classList.toggle('hidden', !enabled);
        }
    }
    // ★ 更新骨骼行收起状态下的淡入淡出图标
    var row = document.querySelector('.dfp-bone-row[data-bone="' + boneName + '"]');
    if (row) {
        var nameSpan = row.querySelector('.dfp-bone-name');
        if (nameSpan) {
            var existingBadge = nameSpan.querySelector('.dfp-bone-fade-badge');
            if (enabled) {
                if (!existingBadge) {
                    var dur = node._boneFade[boneName].duration || 1.0;
                    var badge = document.createElement('span');
                    badge.className = 'dfp-bone-badge dfp-bone-fade-badge';
                    badge.title = '透明度淡入淡出: ' + dur + 's';
                    badge.textContent = '✨';
                    nameSpan.appendChild(badge);
                }
            } else {
                if (existingBadge) existingBadge.remove();
            }
        }
    }
};

// ---- 骨骼淡入淡出时长（同步到所有同源节点）----
SMTool._setBoneFadeDur = function (boneName, value) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._boneFade) n._boneFade = {};
        if (!n._boneFade[boneName]) n._boneFade[boneName] = { enabled: true, duration: 1.0 };
        n._boneFade[boneName].duration = Math.max(0.1, Math.min(60, value || 1.0));
    }
    // ★ 更新淡入淡出图标的 title（显示最新时长）
    var row = document.querySelector('.dfp-bone-row[data-bone="' + boneName + '"]');
    if (row) {
        var badge = row.querySelector('.dfp-bone-fade-badge');
        if (badge) {
            badge.title = '透明度淡入淡出: ' + node._boneFade[boneName].duration + 's';
        }
    }
};

// ★ 淡入淡出数值框步进按钮
SMTool._fadeStepInput = function (btn, dir) {
    var wrap = btn.parentElement;
    if (!wrap) return;
    var inp = wrap.querySelector('.dfp-fade-dur');
    if (!inp) return;
    var v = parseFloat(inp.value) || 1;
    v = dir < 0 ? Math.max(0.1, v - 0.5) : Math.min(60, v + 0.5);
    inp.value = v.toFixed(1);
    if (typeof inp.onchange === 'function') inp.onchange();
};

// ================================================================
// 🔒🔒🔒 [LOCK-K] 皮肤标记/备注/截图/淡入淡出逻辑
// ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
//    如需修改，一定要寻求同意"解锁"才可以。
// ================================================================

SMTool._toggleSkinTag = function (skinName) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node || node.nodeType !== 'spine') return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    var wasMarked = !!(node._skinTags && node._skinTags[skinName]);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._skinTags) n._skinTags = {};
        if (n._skinTags[skinName]) {
            delete n._skinTags[skinName];
        } else {
            n._skinTags[skinName] = true;
        }
    }
    // ★ 标记从灰变红时自动设为粘贴目标
    if (!wasMarked) {
        SMData._pasteTargetBone = skinName;
        SMData._pasteTargetType = 'skin';
    }
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
    // ★ 刷新指示图标
    for (var sj = 0; sj < sameSourceNodes.length; sj++) {
        var n2 = sameSourceNodes[sj];
        var nEl = SMTool._getEl(n2.id);
        if (nEl) {
            var indEl = nEl.querySelector('.node-indicators');
            if (indEl) indEl.outerHTML = SMTool._buildNodeIndicatorsHtml(n2);
        }
    }
};

SMTool._toggleSlotTag = function (slotName) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node || node.nodeType !== 'spine') return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    var wasMarked = !!(node._slotTags && node._slotTags[slotName]);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._slotTags) n._slotTags = {};
        if (n._slotTags[slotName]) {
            delete n._slotTags[slotName];
        } else {
            n._slotTags[slotName] = true;
        }
    }
    // ★ 标记从灰变红时自动设为粘贴目标
    if (!wasMarked) {
        SMData._pasteTargetBone = slotName;
        SMData._pasteTargetType = 'slot';
    }
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
    // ★ 刷新指示图标
    for (var sj = 0; sj < sameSourceNodes.length; sj++) {
        var n2 = sameSourceNodes[sj];
        var nEl = SMTool._getEl(n2.id);
        if (nEl) {
            var indEl = nEl.querySelector('.node-indicators');
            if (indEl) indEl.outerHTML = SMTool._buildNodeIndicatorsHtml(n2);
        }
    }
};

// ---- 皮肤备注 ----
SMTool._updateSkinNote = function (skinName, value) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._skinNotes) n._skinNotes = {};
        n._skinNotes[skinName] = value;
    }
};

// ---- 插槽备注 ----
SMTool._updateSlotNote = function (slotName, value) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._slotNotes) n._slotNotes = {};
        n._slotNotes[slotName] = value;
    }
};

// ---- 皮肤淡入淡出 ----
SMTool._toggleSkinFade = function (skinName, enabled) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._skinFade) n._skinFade = {};
        if (!n._skinFade[skinName]) n._skinFade[skinName] = { enabled: false, duration: 1.0 };
        n._skinFade[skinName].enabled = enabled;
    }
    var wrap = document.querySelector('.dfp-bone-note-area[data-bone-note="' + skinName + '"]');
    if (wrap) {
        var inputWrap = wrap.parentElement.querySelector('.dfp-fade-input-wrap');
        if (inputWrap) inputWrap.classList.toggle('hidden', !enabled);
    }
};

SMTool._setSkinFadeDur = function (skinName, value) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._skinFade) n._skinFade = {};
        if (!n._skinFade[skinName]) n._skinFade[skinName] = { enabled: true, duration: 1.0 };
        n._skinFade[skinName].duration = Math.max(0.1, Math.min(60, value || 1.0));
    }
};

// ---- 插槽淡入淡出 ----
SMTool._toggleSlotFade = function (slotName, enabled) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._slotFade) n._slotFade = {};
        if (!n._slotFade[slotName]) n._slotFade[slotName] = { enabled: false, duration: 1.0 };
        n._slotFade[slotName].enabled = enabled;
    }
    var wrap = document.querySelector('.dfp-bone-note-area[data-bone-note="' + slotName + '"]');
    if (wrap) {
        var inputWrap = wrap.parentElement.querySelector('.dfp-fade-input-wrap');
        if (inputWrap) inputWrap.classList.toggle('hidden', !enabled);
    }
};

SMTool._setSlotFadeDur = function (slotName, value) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var si = 0; si < sameSourceNodes.length; si++) {
        var n = sameSourceNodes[si];
        if (!n._slotFade) n._slotFade = {};
        if (!n._slotFade[slotName]) n._slotFade[slotName] = { enabled: true, duration: 1.0 };
        n._slotFade[slotName].duration = Math.max(0.1, Math.min(60, value || 1.0));
    }
};

// ---- 皮肤截图（文件选取 + 拖拽 + 添加 + 删除 + 查看） ----
SMTool._pickSkinScreenshot = function (skinName) {
    SMData._pasteTargetBone = skinName;
    SMData._pasteTargetType = 'skin';
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = function () {
        var files = input.files;
        if (!files || files.length === 0) return;
        var loaded = 0;
        var dataUrls = [];
        var fileNames = [];
        for (var i = 0; i < files.length; i++) {
            fileNames.push(files[i].name);
            (function (file, idx) {
                var reader = new FileReader();
                reader.onload = function () {
                    dataUrls[idx] = reader.result;
                    loaded++;
                    if (loaded === files.length) SMTool._addSkinScreenshots(skinName, dataUrls, fileNames);
                };
                reader.readAsDataURL(file);
            })(files[i], i);
        }
    };
    input.click();
};

SMTool._dropSkinScreenshot = function (e, skinName) {
    var files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    var loaded = 0;
    var dataUrls = [];
    var fileNames = [];
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!file.type.startsWith('image/')) continue;
        fileNames.push(file.name);
        (function (f, idx) {
            var reader = new FileReader();
            reader.onload = function () {
                dataUrls[idx] = reader.result;
                loaded++;
                if (loaded === files.length) SMTool._addSkinScreenshots(skinName, dataUrls, fileNames);
            };
            reader.readAsDataURL(f);
        })(file, i);
    }
};

SMTool._addSkinScreenshots = function (skinName, dataUrls, fileNames) {
    SMTool._addScreenshots(skinName, dataUrls, 'skin', fileNames);
};

SMTool._removeSkinScreenshot = function (skinName, index) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node || !node._skinScreenshots || !node._skinScreenshots[skinName]) return;
    if (!Array.isArray(node._skinScreenshots[skinName])) return;
    var shotId = node._skinScreenshots[skinName][index];
    node._skinScreenshots[skinName].splice(index, 1);
    if (node._skinScreenshots[skinName].length === 0) delete node._skinScreenshots[skinName];
    if (!SMData._hasEverSaved && typeof shotId === 'number') {
        var stillUsed = false;
        var nodesIter = SMData.nodes.values();
        var nr = nodesIter.next();
        while (!nr.done) {
            var n = nr.value;
            if (n._skinScreenshots) {
                var keys = Object.keys(n._skinScreenshots);
                for (var bk = 0; bk < keys.length; bk++) {
                    var shots = n._skinScreenshots[keys[bk]];
                    if (Array.isArray(shots) && shots.indexOf(shotId) >= 0) { stillUsed = true; break; }
                }
            }
            if (stillUsed) break;
            nr = nodesIter.next();
        }
        if (!stillUsed) SMData._shotRelease(shotId);
    }
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
};

SMTool._openSkinScreenshot = function (skinName, index) {
    SMTool._openScreenshot(skinName, index, '_skinScreenshots');
};

// ---- 插槽截图（文件选取 + 拖拽 + 添加 + 删除 + 查看） ----
SMTool._pickSlotScreenshot = function (slotName) {
    SMData._pasteTargetBone = slotName;
    SMData._pasteTargetType = 'slot';
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = function () {
        var files = input.files;
        if (!files || files.length === 0) return;
        var loaded = 0;
        var dataUrls = [];
        var fileNames = [];
        for (var i = 0; i < files.length; i++) {
            fileNames.push(files[i].name);
            (function (file, idx) {
                var reader = new FileReader();
                reader.onload = function () {
                    dataUrls[idx] = reader.result;
                    loaded++;
                    if (loaded === files.length) SMTool._addSlotScreenshots(slotName, dataUrls, fileNames);
                };
                reader.readAsDataURL(file);
            })(files[i], i);
        }
    };
    input.click();
};

SMTool._dropSlotScreenshot = function (e, slotName) {
    var files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    var loaded = 0;
    var dataUrls = [];
    var fileNames = [];
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!file.type.startsWith('image/')) continue;
        fileNames.push(file.name);
        (function (f, idx) {
            var reader = new FileReader();
            reader.onload = function () {
                dataUrls[idx] = reader.result;
                loaded++;
                if (loaded === files.length) SMTool._addSlotScreenshots(slotName, dataUrls, fileNames);
            };
            reader.readAsDataURL(f);
        })(file, i);
    }
};

SMTool._addSlotScreenshots = function (slotName, dataUrls, fileNames) {
    SMTool._addScreenshots(slotName, dataUrls, 'slot', fileNames);
};

SMTool._removeSlotScreenshot = function (slotName, index) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node || !node._slotScreenshots || !node._slotScreenshots[slotName]) return;
    if (!Array.isArray(node._slotScreenshots[slotName])) return;
    var shotId = node._slotScreenshots[slotName][index];
    node._slotScreenshots[slotName].splice(index, 1);
    if (node._slotScreenshots[slotName].length === 0) delete node._slotScreenshots[slotName];
    if (!SMData._hasEverSaved && typeof shotId === 'number') {
        var stillUsed = false;
        var nodesIter = SMData.nodes.values();
        var nr = nodesIter.next();
        while (!nr.done) {
            var n = nr.value;
            if (n._slotScreenshots) {
                var keys = Object.keys(n._slotScreenshots);
                for (var bk = 0; bk < keys.length; bk++) {
                    var shots = n._slotScreenshots[keys[bk]];
                    if (Array.isArray(shots) && shots.indexOf(shotId) >= 0) { stillUsed = true; break; }
                }
            }
            if (stillUsed) break;
            nr = nodesIter.next();
        }
        if (!stillUsed) SMData._shotRelease(shotId);
    }
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
};

SMTool._openSlotScreenshot = function (slotName, index) {
    SMTool._openScreenshot(slotName, index, '_slotScreenshots');
};
// 🔒 [LOCK-K] END

// ---- 生成缩略图（max 128px，大幅减小面板渲染开销）----
SMTool._generateThumbnail = function (dataUrl) {
    return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
            var maxSize = 128;
            var w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                var ratio = Math.min(maxSize / w, maxSize / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = function () { resolve(null); }; // 生成失败 → 返回 null，由调用方处理
        img.src = dataUrl;
    });
};

// ---- 添加截图（统一入口，支持骨骼/皮肤/插槽/关键帧）----
SMTool._addScreenshots = function (name, dataUrls, type, fileNames) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node || node.nodeType !== 'spine') return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    type = type || 'bone';

    // ★ 根据类型确定存储字段
    var storageKey;
    if (type === 'skin') storageKey = '_skinScreenshots';
    else if (type === 'slot') storageKey = '_slotScreenshots';
    else if (type === 'event') storageKey = '_eventScreenshots';
    else storageKey = '_boneScreenshots';

    var newShotIds = [];
    for (var i = 0; i < dataUrls.length; i++) {
        var shotId = SMData._shotRegister(dataUrls[i]);
        var entry = SMData._shotStore[shotId];
        if (entry && fileNames && fileNames[i] && !entry._fileName) {
            entry._fileName = fileNames[i];
        }
        newShotIds.push(shotId);
        for (var ni = 0; ni < sameSourceNodes.length; ni++) {
            var sn = sameSourceNodes[ni];
            if (!sn[storageKey]) sn[storageKey] = {};
            if (!sn[storageKey][name]) sn[storageKey][name] = [];
            if (!Array.isArray(sn[storageKey][name])) sn[storageKey][name] = sn[storageKey][name] ? [sn[storageKey][name]] : [];
            sn[storageKey][name].push(shotId);
        }
    }

    var refreshPanel = function () {
        SMData._lastPanelNodeId = -1;
        SMTool._updateFloatPanel();
    };

    if (newShotIds.length > 0) {
        var _genThumb = SMTool._generateThumbnail;
        var _thumbPromises = [];
        for (var j = 0; j < newShotIds.length; j++) {
            (function (sid) {
                var e = SMData._shotStore[sid];
                if (e && !e.thumbDataUrl) {
                    _thumbPromises.push(_genThumb(e.dataUrl).then(function (thumb) {
                        e.thumbDataUrl = thumb;
                    }));
                }
            })(newShotIds[j]);
        }
        if (_thumbPromises.length > 0) {
            Promise.all(_thumbPromises).then(refreshPanel);
        } else {
            refreshPanel();
        }
    } else {
        refreshPanel();
    }
};

// ---- 向后兼容：旧函数委托到统一入口 ----
SMTool._addBoneScreenshots = function (boneName, dataUrls, fileNames) {
    SMTool._addScreenshots(boneName, dataUrls, 'bone', fileNames);
};
SMTool._addSkinScreenshots = function (skinName, dataUrls, fileNames) {
    SMTool._addScreenshots(skinName, dataUrls, 'skin', fileNames);
};
SMTool._addSlotScreenshots = function (slotName, dataUrls, fileNames) {
    SMTool._addScreenshots(slotName, dataUrls, 'slot', fileNames);
};
SMTool._addEventScreenshots = function (eventName, dataUrls) {
    SMTool._addScreenshots(eventName, dataUrls, 'event', []);
};

// ★ 切换骨骼截图的挂载状态（同步到所有多选同源节点）
SMTool._toggleBoneShotMount = function (boneName, index) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var sameSourceNodes = SMTool._getSameSourceNodes(node);
    for (var ni = 0; ni < sameSourceNodes.length; ni++) {
        var n = sameSourceNodes[ni];
        if (!n._boneShotMounted) n._boneShotMounted = {};
        if (!n._boneShotMounted[boneName]) n._boneShotMounted[boneName] = {};
        var cur = n._boneShotMounted[boneName][index];
        n._boneShotMounted[boneName][index] = (cur === false);
    }
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
};

// ---- 截图文件选择 ----
SMTool._pickScreenshot = function (boneName) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = function () {
        var files = input.files;
        if (!files || files.length === 0) return;
        var loaded = 0;
        var dataUrls = [];
        var fileNames = [];
        for (var i = 0; i < files.length; i++) {
            fileNames.push(files[i].name);
            (function (file, idx) {
                var reader = new FileReader();
                reader.onload = function () {
                    dataUrls[idx] = reader.result;
                    loaded++;
                    if (loaded === files.length) SMTool._addBoneScreenshots(boneName, dataUrls, fileNames);
                };
                reader.readAsDataURL(file);
            })(files[i], i);
        }
    };
    input.click();
};

// ---- 拖入截图 ----
SMTool._dropScreenshot = function (e, boneName) {
    var files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    var loaded = 0;
    var dataUrls = [];
    var fileNames = [];
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!file.type.startsWith('image/')) continue;
        fileNames.push(file.name);
        (function (f, idx) {
            var reader = new FileReader();
            reader.onload = function () {
                dataUrls[idx] = reader.result;
                loaded++;
                if (loaded === files.length) SMTool._addBoneScreenshots(boneName, dataUrls, fileNames);
            };
            reader.readAsDataURL(f);
        })(file, i);
    }
};

// ---- 节点面板右上角图片附件（选取/拖放/删除） ----
SMTool._pickNodeImage = function (nid) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = function () {
        var files = input.files;
        if (!files || files.length === 0) return;
        var node = SMData.nodes.get(nid);
        if (!node) return;
        var loaded = 0;
        var dataUrls = [];
        for (var i = 0; i < files.length; i++) {
            (function (file, idx) {
                var reader = new FileReader();
                reader.onload = function () {
                    dataUrls[idx] = reader.result;
                    loaded++;
                    if (loaded === files.length) {
                        if (!node._nodeShotRefs) node._nodeShotRefs = [];
                        for (var j = 0; j < dataUrls.length; j++) {
                            if (dataUrls[j]) {
                                var sid = SMData._shotRegister(dataUrls[j]);
                                node._nodeImages.push(sid);
                                // ★ 同步更新 _nodeShotRefs（用于保存/加载）
                                var ent = SMData._shotStore[sid];
                                var ext2 = 'png';
                                if (ent && ent.dataUrl) {
                                    var m2 = ent.dataUrl.match(/^data:(image\/\w+);/);
                                    if (m2) ext2 = m2[1].split('/')[1];
                                    if (ext2 === 'jpeg') ext2 = 'jpg';
                                }
                                node._nodeShotRefs.push('_assets/img_' + sid + '.' + ext2);
                            }
                        }
                        SMTool._refreshNodeImages(nid);
                    }
                };
                reader.readAsDataURL(file);
            })(files[i], i);
        }
    };
    input.click();
};

SMTool._dropNodeImage = function (e, nid) {
    var files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    var node = SMData.nodes.get(nid);
    if (!node) return;
    var loaded = 0;
    var dataUrls = [];
    for (var i = 0; i < files.length; i++) {
        var file = files[i];
        if (!file.type.startsWith('image/')) continue;
        (function (f, idx) {
            var reader = new FileReader();
            reader.onload = function () {
                dataUrls[idx] = reader.result;
                loaded++;
                if (loaded === files.length) {
                    if (!node._nodeShotRefs) node._nodeShotRefs = [];
                    for (var j = 0; j < dataUrls.length; j++) {
                        if (dataUrls[j]) {
                            var sid2 = SMData._shotRegister(dataUrls[j]);
                            node._nodeImages.push(sid2);
                            var ent2 = SMData._shotStore[sid2];
                            var ext3 = 'png';
                            if (ent2 && ent2.dataUrl) {
                                var m3 = ent2.dataUrl.match(/^data:(image\/\w+);/);
                                if (m3) ext3 = m3[1].split('/')[1];
                                if (ext3 === 'jpeg') ext3 = 'jpg';
                            }
                            node._nodeShotRefs.push('_assets/img_' + sid2 + '.' + ext3);
                        }
                    }
                    SMTool._refreshNodeImages(nid);
                }
            };
            reader.readAsDataURL(f);
        })(file, i);
    }
};

// ★ 刷新节点面板图片缩略图（spine 右上角竖排，entry 下方横排）
// ★ 缩略图懒生成完成 → 刷新引用该 shotId 的所有节点
SMTool._refreshNodeImageByShotId = function (shotId) {
    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        var nd = r.value;
        if (nd._nodeImages && nd._nodeImages.indexOf(shotId) >= 0 && (nd.nodeType === 'spine' || nd.nodeType === 'entry')) {
            SMTool._refreshNodeImages(nd.id);
        }
        r = nodesIter.next();
    }
};

// ★ 重新尝试生成节点图片缩略图
SMTool._retryNodeImageThumb = function (nid, index) {
    var node = SMData.nodes.get(nid);
    if (!node || !node._nodeImages) return;
    var shotId = node._nodeImages[index];
    if (typeof shotId !== 'number') return;
    var entry = SMData._shotStore[shotId];
    if (entry) {
        entry._thumbFailed = false;
        entry._thumbPending = false;
    }
    SMTool._refreshNodeImages(nid);
};

SMTool._refreshNodeImages = function (nid) {
    var el = SMTool._getEl(nid);
    if (!el) return;
    var node = SMData.nodes.get(nid);
    if (!node || !node._nodeImages || node._nodeImages.length === 0) {
        var oldC2 = el.querySelector('.node-images');
        if (oldC2) { oldC2.innerHTML = ''; oldC2.style.display = 'none'; }
        return;
    }
    var isEntry = (node.nodeType === 'entry');
    var container = el.querySelector('.node-images');
    if (!container) {
        container = document.createElement('div');
        container.className = 'node-images';
        if (isEntry) container.classList.add('node-images-entry');
        el.appendChild(container);
    }
    container.style.display = 'flex';
    if (isEntry) {
        container.style.flexDirection = 'row';
        container.style.position = 'static';
        container.style.left = 'auto';
        container.style.right = 'auto';
        container.style.top = 'auto';
    }
    var thumbW = Math.round((node.width || 300) * 0.56);
    var thumbH = Math.round(thumbW * 0.75);
    var html = '';
    for (var i = 0; i < node._nodeImages.length; i++) {
        var shotId = node._nodeImages[i];
        if (shotId === null || shotId === undefined) {
            html += '<div class="node-img-item node-img-missing" style="width:' + thumbW + 'px;height:' + thumbH + 'px" ' +
                'onclick="event.stopPropagation();SMTool._reacquireNodeImage(' + nid + ',' + i + ')" title="资源丢失，点击重新获取">' +
                '<span class="node-img-missing-icon">📁</span>' +
                '<span class="node-img-missing-text">点击重新获取</span>' +
                '<span class="node-img-del" onclick="event.stopPropagation();SMTool._removeNodeImage(' + nid + ',' + i + ')" title="删除">×</span>' +
                '</div>';
        } else {
            var entry = SMData._shotStore[shotId];
            var thumb = SMData._shotGetThumb(shotId);
            if (!thumb && entry && entry._thumbPending) {
                // ★ 缩略图正在异步生成中 → 显示加载占位符
                html += '<div class="node-img-item node-img-loading" style="width:' + thumbW + 'px;height:' + thumbH + 'px" title="缩略图生成中...">' +
                    '<span class="node-img-missing-icon">⏳</span>' +
                    '<span class="node-img-del" onclick="event.stopPropagation();SMTool._removeNodeImage(' + nid + ',' + i + ')" title="删除">×</span>' +
                    '</div>';
            } else if (!thumb) {
                // ★ 无缩略图（生成失败或数据缺失）→ 显示丢失占位符，点击尝试重新加载
                if (entry && entry._thumbFailed) {
                    // 生成失败 → 点击重新尝试生成缩略图
                    html += '<div class="node-img-item node-img-missing" style="width:' + thumbW + 'px;height:' + thumbH + 'px" ' +
                        'onclick="event.stopPropagation();SMTool._retryNodeImageThumb(' + nid + ',' + i + ')" title="缩略图生成失败，点击重试">' +
                        '<span class="node-img-missing-icon">🖼️</span>' +
                        '<span class="node-img-missing-text">点击重试</span>' +
                        '<span class="node-img-del" onclick="event.stopPropagation();SMTool._removeNodeImage(' + nid + ',' + i + ')" title="删除">×</span>' +
                        '</div>';
                } else {
                html += '<div class="node-img-item node-img-missing" style="width:' + thumbW + 'px;height:' + thumbH + 'px" ' +
                    'onclick="event.stopPropagation();SMTool._reacquireNodeImage(' + nid + ',' + i + ')" title="资源丢失，点击重新获取">' +
                    '<span class="node-img-missing-icon">📁</span>' +
                    '<span class="node-img-missing-text">点击重新获取</span>' +
                    '<span class="node-img-del" onclick="event.stopPropagation();SMTool._removeNodeImage(' + nid + ',' + i + ')" title="删除">×</span>' +
                    '</div>';
                }
            } else {
                html += '<div class="node-img-item" style="width:' + thumbW + 'px;height:' + thumbH + 'px">' +
                    '<img src="' + thumb + '" onclick="event.stopPropagation();SMTool._openNodeImage(' + nid + ',' + i + ')" title="点击查看大图">' +
                    '<span class="node-img-del" onclick="event.stopPropagation();SMTool._removeNodeImage(' + nid + ',' + i + ')" title="删除">×</span>' +
                    '</div>';
            }
        }
    }
    container.innerHTML = html;
};

// ★ 重新获取丢失的节点图片（打开文件选择器）
SMTool._reacquireNodeImage = function (nid, index) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = function () {
        var file = inp.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            var oldShotId = node._nodeImages[index];
            var newShotId = SMData._shotRegister(reader.result);
            node._nodeImages[index] = newShotId;
            // ★ 释放旧 shotId 引用计数
            if (typeof oldShotId === 'number' && oldShotId !== newShotId) SMData._shotRelease(oldShotId);
            // ★ 同步更新 _nodeShotRefs
            if (!node._nodeShotRefs) node._nodeShotRefs = [];
            // 确保数组长度足够
            while (node._nodeShotRefs.length <= index) node._nodeShotRefs.push('');
            var entry = SMData._shotStore[newShotId];
            var ext = 'png';
            if (entry && entry.dataUrl) {
                var m = entry.dataUrl.match(/^data:(image\/\w+);/);
                if (m) ext = m[1].split('/')[1];
                if (ext === 'jpeg') ext = 'jpg';
            }
            node._nodeShotRefs[index] = '_assets/img_' + newShotId + '.' + ext;
            SMTool._refreshNodeImages(nid);
        };
        reader.onerror = function () { alert('读取图片失败'); };
        reader.readAsDataURL(file);
    };
    inp.click();
};

SMTool._removeNodeImage = function (nid, index) {
    var node = SMData.nodes.get(nid);
    if (!node || !node._nodeImages) return;
    var shotId = node._nodeImages[index];
    if (typeof shotId === 'number') SMData._shotRelease(shotId);
    node._nodeImages.splice(index, 1);
    if (node._nodeShotRefs) node._nodeShotRefs.splice(index, 1);
    SMTool._refreshNodeImages(nid);
};

SMTool._openNodeImage = function (nid, index) {
    var node = SMData.nodes.get(nid);
    if (!node || !node._nodeImages || node._nodeImages.length === 0) return;
    var shots = node._nodeImages;
    if (index === undefined) index = 0;
    if (index >= shots.length) index = 0;
    var shotId = shots[index];
    var dataUrl = SMData._shotGetDataUrl(shotId);
    if (!dataUrl) return;

    var overlay = document.getElementById('screenshotOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'screenshotOverlay';
        overlay.innerHTML =
            '<div class="shot-viewer">' +
                '<img src="" alt="截图" draggable="false">' +
                '<div class="shot-nav-bar">' +
                    '<button class="shot-nav-prev" title="上一张 (←)">◀</button>' +
                    '<span class="shot-nav-info"></span>' +
                    '<button class="shot-nav-next" title="下一张 (→)">▶</button>' +
                    '<span class="shot-nav-sep">|</span>' +
                    '<button class="shot-nav-zoomin" title="放大 (+)">🔍⁺</button>' +
                    '<span class="shot-zoom-label">100%</span>' +
                    '<button class="shot-nav-zoomout" title="缩小 (−)">🔍⁻</button>' +
                    '<button class="shot-nav-reset" title="重置 (0)">↺</button>' +
                '</div>' +
                '<span class="close-hint">点击空白关闭 | ESC 关闭 | 滚轮缩放 | ◀▶ 切换</span>' +
            '</div>';
        document.body.appendChild(overlay);
    }
    // 清理旧事件
    if (overlay._keyHandler) document.removeEventListener('keydown', overlay._keyHandler);
    if (overlay._wheelHandler) { var oldImg = overlay.querySelector('img'); if (oldImg) oldImg.removeEventListener('wheel', overlay._wheelHandler); }
    overlay._nodeImagesRef = { nid: nid, shots: shots };
    overlay.classList.add('show');

    var img = overlay.querySelector('img');
    var curIdx = index;
    var updateImg = function () {
        var sid = shots[curIdx];
        img.src = SMData._shotGetDataUrl(sid) || '';
        img.style.transform = 'scale(1)';
        overlay.querySelector('.shot-zoom-label').textContent = '100%';
        overlay.querySelector('.shot-nav-info').textContent = (curIdx + 1) + ' / ' + shots.length;
    };
    updateImg();

    overlay.querySelector('.shot-nav-prev').onclick = function (e) { e.stopPropagation(); curIdx = (curIdx - 1 + shots.length) % shots.length; updateImg(); };
    overlay.querySelector('.shot-nav-next').onclick = function (e) { e.stopPropagation(); curIdx = (curIdx + 1) % shots.length; updateImg(); };
    overlay.querySelector('.shot-nav-zoomin').onclick = function (e) { e.stopPropagation(); var s = parseFloat(img.style.transform.replace('scale(','').replace(')','')) || 1; s = Math.min(5, s + 0.25); img.style.transform = 'scale(' + s + ')'; overlay.querySelector('.shot-zoom-label').textContent = Math.round(s * 100) + '%'; };
    overlay.querySelector('.shot-nav-zoomout').onclick = function (e) { e.stopPropagation(); var s = parseFloat(img.style.transform.replace('scale(','').replace(')','')) || 1; s = Math.max(0.25, s - 0.25); img.style.transform = 'scale(' + s + ')'; overlay.querySelector('.shot-zoom-label').textContent = Math.round(s * 100) + '%'; };
    overlay.querySelector('.shot-nav-reset').onclick = function (e) { e.stopPropagation(); img.style.transform = 'scale(1)'; overlay.querySelector('.shot-zoom-label').textContent = '100%'; };
    overlay.onclick = function (e) {
        // 点击 overlay 背景 或 shot-viewer 容器空白区域 → 关闭
        // 但不关闭 img / 导航按钮上的点击
        if (e.target === overlay || e.target.classList.contains('shot-viewer')) {
            SMTool._closeScreenshot();
        }
    };
    overlay._keyHandler = function (e2) { if (e2.key === 'Escape') SMTool._closeScreenshot(); };
    document.addEventListener('keydown', overlay._keyHandler);
    overlay._wheelHandler = function (e2) { e2.preventDefault(); var s = parseFloat(img.style.transform.replace('scale(','').replace(')','')) || 1; s = Math.max(0.25, Math.min(5, s + (e2.deltaY > 0 ? -0.25 : 0.25))); img.style.transform = 'scale(' + s + ')'; overlay.querySelector('.shot-zoom-label').textContent = Math.round(s * 100) + '%'; };
    img.addEventListener('wheel', overlay._wheelHandler);
};

// ---- 删除骨骼截图 ----
SMTool._removeBoneScreenshot = function (boneName, index) {
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node || !node._boneScreenshots || !node._boneScreenshots[boneName]) return;
    if (!Array.isArray(node._boneScreenshots[boneName])) return;

    var shotId = node._boneScreenshots[boneName][index];
    // 仅移除当前节点的引用
    node._boneScreenshots[boneName].splice(index, 1);
    if (node._boneScreenshots[boneName].length === 0) delete node._boneScreenshots[boneName];

    // ★ 未保存 + 无任何节点引用 → 允许释放内存
    if (!SMData._hasEverSaved && typeof shotId === 'number') {
        var stillUsed = false;
        var nodesIter = SMData.nodes.values();
        var nr = nodesIter.next();
        while (!nr.done) {
            var n = nr.value;
            if (n._boneScreenshots) {
                var boneKeys = Object.keys(n._boneScreenshots);
                for (var bk = 0; bk < boneKeys.length; bk++) {
                    var shots = n._boneScreenshots[boneKeys[bk]];
                    if (Array.isArray(shots) && shots.indexOf(shotId) >= 0) { stillUsed = true; break; }
                }
            }
            if (stillUsed) break;
            nr = nodesIter.next();
        }
        if (!stillUsed) SMData._shotRelease(shotId);
    }
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();
};

// ---- 粘贴截图按钮（引导用户 Ctrl+V，无需剪贴板权限）----
SMTool._pasteScreenshot = function (itemName, type) {
    SMData._pasteTargetBone = itemName;
    SMData._pasteTargetType = type || 'bone';
    var btns = document.querySelectorAll('.dfp-shot-btn-paste');
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.add('active');
        setTimeout((function (btn) { return function () { btn.classList.remove('active'); }; })(btns[i]), 1500);
    }
    document.getElementById('sbStatus').textContent = '📋 请按 Ctrl+V 粘贴截图 → ' + itemName;
    setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 3000);
};
SMTool._closeScreenshot = function () {
    var overlay = document.getElementById('screenshotOverlay');
    if (overlay) {
        overlay.classList.remove('show');
        if (overlay._keyHandler) document.removeEventListener('keydown', overlay._keyHandler);
        // 清理 img 上的滚轮事件
        var img = overlay.querySelector('img');
        if (img && overlay._wheelHandler) img.removeEventListener('wheel', overlay._wheelHandler);
        overlay._keyHandler = null;
        overlay._wheelHandler = null;
    }
};

// ---- 懒加载面板中的截图图片（已废弃：缩略图在 HTML 构建时直接使用真实图片）----
SMTool._loadPanelImages = function () {
    // ★ 不再需要：缩略图已预生成并直接在 _buildBoneRowHtml 中使用
};

// ---- 释放面板中已加载的图片（已废弃：缩略图极小，保持在 DOM 中无内存压力）----
SMTool._unloadPanelImages = function () {
    // ★ 不再需要：128px JPEG 缩略图仅 ~5-15KB，无需卸载
};

SMTool._openScreenshot = function (boneName, index, storageKey) {
    storageKey = storageKey || '_boneScreenshots';
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) return;
    var shots = node[storageKey] && node[storageKey][boneName];
    if (!shots) return;
    if (!Array.isArray(shots)) shots = [shots];
    if (index === undefined) index = 0;
    if (index >= shots.length) index = 0;
    if (!shots[index]) return;

    var overlay = document.getElementById('screenshotOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'screenshotOverlay';
        overlay.innerHTML =
            '<div class="shot-viewer">' +
                '<img src="" alt="截图" draggable="false">' +
                '<div class="shot-nav-bar">' +
                    '<button class="shot-nav-prev" title="上一张 (←)">◀</button>' +
                    '<span class="shot-nav-info"></span>' +
                    '<button class="shot-nav-next" title="下一张 (→)">▶</button>' +
                    '<span class="shot-nav-sep">|</span>' +
                    '<button class="shot-nav-zoomin" title="放大 (+)">🔍⁺</button>' +
                    '<span class="shot-zoom-label">100%</span>' +
                    '<button class="shot-nav-zoomout" title="缩小 (−)">🔍⁻</button>' +
                    '<button class="shot-nav-reset" title="重置 (0)">↺</button>' +
                '</div>' +
                '<span class="close-hint">点击空白关闭 | ESC 关闭 | 滚轮缩放 | ◀▶ 切换</span>' +
            '</div>';
        document.body.appendChild(overlay);

        // ESC 关闭
        overlay._escHandler = function (e2) { if (e2.key === 'Escape') SMTool._closeScreenshot(); };
        document.addEventListener('keydown', overlay._escHandler);
    }

    var img = overlay.querySelector('img');
    var navBar = overlay.querySelector('.shot-nav-bar');
    var navInfo = overlay.querySelector('.shot-nav-info');
    var zoomLabel = overlay.querySelector('.shot-zoom-label');
    var prevBtn = overlay.querySelector('.shot-nav-prev');
    var nextBtn = overlay.querySelector('.shot-nav-next');
    var zoomInBtn = overlay.querySelector('.shot-nav-zoomin');
    var zoomOutBtn = overlay.querySelector('.shot-nav-zoomout');
    var resetBtn = overlay.querySelector('.shot-nav-reset');

    // 状态
    var curIdx = index;
    var curZoom = 1.0;
    var minZoom = 0.1;
    var maxZoom = 8.0;

    var updateImage = function () {
        if (curIdx >= 0 && curIdx < shots.length) {
            var shotVal = shots[curIdx];
            // 兼容新旧格式：shotId（数字）从全局注册表取 dataUrl，旧格式直接使用字符串
            img.src = (typeof shotVal === 'number') ? (SMData._shotGetDataUrl(shotVal) || '') : shotVal;
        }
        img.style.transform = 'scale(' + curZoom + ')';
        img.style.transformOrigin = 'center center';
        zoomLabel.textContent = Math.round(curZoom * 100) + '%';
        navInfo.textContent = (curIdx + 1) + ' / ' + shots.length;
        prevBtn.style.opacity = curIdx > 0 ? '1' : '0.35';
        nextBtn.style.opacity = curIdx < shots.length - 1 ? '1' : '0.35';
        if (shots.length <= 1) {
            prevBtn.style.display = 'none';
            nextBtn.style.display = 'none';
            navInfo.style.display = 'none';
        } else {
            prevBtn.style.display = '';
            nextBtn.style.display = '';
            navInfo.style.display = '';
        }
    };

    updateImage();

    // 键盘切换
    overlay._keyHandler = function (e) {
        if (e.key === 'ArrowLeft' && curIdx > 0) { curIdx--; updateImage(); e.preventDefault(); }
        if (e.key === 'ArrowRight' && curIdx < shots.length - 1) { curIdx++; updateImage(); e.preventDefault(); }
        if (e.key === '+' || e.key === '=') { curZoom = Math.min(maxZoom, curZoom * 1.3); updateImage(); e.preventDefault(); }
        if (e.key === '-') { curZoom = Math.max(minZoom, curZoom / 1.3); updateImage(); e.preventDefault(); }
        if (e.key === '0') { curZoom = 1.0; updateImage(); e.preventDefault(); }
        if (e.key === 'Escape') SMTool._closeScreenshot();
    };
    document.addEventListener('keydown', overlay._keyHandler);

    // 滚轮缩放（仅在图片上滚动时生效）
    overlay._wheelHandler = function (e) {
        e.preventDefault();
        e.stopPropagation();
        var delta = e.deltaY > 0 ? 0.9 : 1.1;
        curZoom = Math.max(minZoom, Math.min(maxZoom, curZoom * delta));
        updateImage();
    };
    img.addEventListener('wheel', overlay._wheelHandler, { passive: false });

    // 按钮事件
    prevBtn.onclick = function (e) { e.stopPropagation(); if (curIdx > 0) { curIdx--; updateImage(); } };
    nextBtn.onclick = function (e) { e.stopPropagation(); if (curIdx < shots.length - 1) { curIdx++; updateImage(); } };
    zoomInBtn.onclick = function (e) { e.stopPropagation(); curZoom = Math.min(maxZoom, curZoom * 1.3); updateImage(); };
    zoomOutBtn.onclick = function (e) { e.stopPropagation(); curZoom = Math.max(minZoom, curZoom / 1.3); updateImage(); };
    resetBtn.onclick = function (e) { e.stopPropagation(); curZoom = 1.0; updateImage(); };

    // 点击图片不关闭
    img.onclick = function (e) { e.stopPropagation(); };
    // 点击导航栏不关闭
    navBar.onclick = function (e) { e.stopPropagation(); };
    // 点击空白处 → 关闭
    overlay.onclick = function () { SMTool._closeScreenshot(); };
    // 阻止面板下层的画布事件
    overlay.onmousedown = function (e) { e.stopPropagation(); };
    overlay.addEventListener('wheel', function (e) {
        // 仅在非图片区域拦截滚轮，图片上的滚轮留给 _wheelHandler 处理缩放
        if (e.target !== img) e.stopPropagation();
    }, true);
    overlay.addEventListener('contextmenu', function (e) { e.stopPropagation(); e.preventDefault(); });

    overlay.classList.add('show');
};

// ---- 挂点添加按钮：弹出骨骼选择菜单 ----
SMTool._showBoneAddMenu = function (e, nid) {
    e.stopPropagation();
    var node = SMData.nodes.get(nid);
    if (!node || node.bones.length === 0) return;
    var menu = document.createElement('div');
    menu.className = 'bone-state-menu';
    menu.style.cssText = 'position:fixed;z-index:200;background:var(--panel-bg);border:1px solid var(--border);border-radius:8px;padding:4px;max-height:300px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,0.5);min-width:180px';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    for (var i = 0; i < node.bones.length; i++) {
        var bn = node.bones[i];
        var item = document.createElement('div');
        item.className = 'bone-state-item';
        item.textContent = bn;
        // ★ 添加内联样式确保菜单项可见可点击
        item.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:20px;color:var(--text);border-radius:4px;white-space:nowrap';
        item.onmouseover = function () { this.style.background = 'var(--node-bg)'; };
        item.onmouseout = function () { this.style.background = 'transparent'; };
        (function (bn2, targetNid) {
            item.onclick = function (ev2) {
                ev2.stopPropagation();
                if (menu.parentNode) document.body.removeChild(menu);
                // ★ 确保目标节点被选中后再添加标记
                var prevSel = SMData.selectedNode;
                SMData.selectedNode = targetNid;
                SMData.selectedNodes.clear();
                SMData.selectedNodes.add(targetNid);
                SMTool._updateSel();
                SMTool._toggleBoneTag(bn2);
            };
        })(bn, nid);
        menu.appendChild(item);
    }
    document.body.appendChild(menu);
    setTimeout(function () {
        var closeMenu = function (ev) {
            if (!menu.parentNode) { document.removeEventListener('click', closeMenu); return; }
            if (!menu.contains(ev.target)) { document.body.removeChild(menu); document.removeEventListener('click', closeMenu); }
        };
        document.addEventListener('click', closeMenu);
    }, 0);
};

SMTool._showBoneStateMenu = function (e, nid, boneName) {
    e.stopPropagation();
    var node = SMData.nodes.get(nid);
    if (!node) return;
    var menu = document.createElement('div');
    menu.className = 'bone-state-menu';
    menu.style.cssText = 'position:fixed;z-index:200;background:var(--panel-bg);border:1px solid var(--border);border-radius:8px;padding:4px;max-height:200px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    for (var i = 0; i < node.animations.length; i++) {
        var an = node.animations[i].name;
        var item = document.createElement('div');
        item.className = 'bone-state-item';
        item.textContent = an;
        item.style.cssText = 'padding:4px 10px;cursor:pointer;font-size:13px;color:var(--text);border-radius:4px';
        item.onmouseover = function () { this.style.background = 'var(--node-bg)'; };
        item.onmouseout = function () { this.style.background = 'transparent'; };
        (function (an2) {
            item.onclick = function () {
                SMTool._addBoneTagState(nid, boneName, an2);
                menu.remove();
            };
        })(an);
        menu.appendChild(item);
    }
    document.body.appendChild(menu);
    var close = function (ev) {
        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); }
    };
    setTimeout(function () { document.addEventListener('click', close); }, 0);
};

// ---- 更新节点 DOM ----
SMTool._updateEl = function (node) {
    var el = SMTool._getEl(node.id);
    if (!el) return;
    if (node.nodeType !== 'spine') return;  // 文本节点无需刷新

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
    var curStateEsc = SMTool._escAttr(curState);
    var inputDot = el.querySelector('.anim-bar .conn-dot.input');
    var outputDot = el.querySelector('.anim-bar .conn-dot.output');
    if (inputDot) inputDot.setAttribute('onclick', "event.stopPropagation();SMTool._onDot(" + node.id + ",'" + curStateEsc + "','input')");
    if (outputDot) outputDot.setAttribute('onclick', "event.stopPropagation();SMTool._onDot(" + node.id + ",'" + curStateEsc + "','output')");

    // 底部信息
    var ft = el.querySelector('.footer');
    if (ft) {
        var currentSkin2 = node.currentSkin || (node.skeletonData && node.skeletonData.defaultSkin && node.skeletonData.defaultSkin.name) || (node.skins[0] || '');
        var skinsHtml = '';
        for (var si = 0; si < node.skins.length; si++) {
            var skinName = node.skins[si];
            var isActive = skinName === currentSkin2 ? ' active' : '';
            skinsHtml += '<span class="badge skin-badge' + isActive + '" onclick="event.stopPropagation();SMTool._setSkin(' + node.id + ',\'' + SMTool._escAttr(skinName) + '\')" title="切换皮肤: ' + SMTool._esc(skinName) + '">' + SMTool._esc(skinName) + '</span>';
        }
        ft.innerHTML =
            '<div class="footer-controls">' +
                '<button class="loop-toggle' + (node.loop !== false ? ' active' : '') + '" onclick="event.stopPropagation();SMTool._toggleLoop(' + node.id + ')">' + (node.loop !== false ? '🔄 循环播放' : '▶ 单次播放') + '</button>' +
                '<label class="pma-toggle" title="预乘 Alpha"><input type="checkbox" onchange="SMTool._togglePMA(' + node.id + ',this.checked)"' + (node.premultipliedAlpha ? ' checked' : '') + '>预乘Alpha</label>' +
            '</div>' +
            '<div class="footer-skins"><span class="skin-label">皮肤</span>' + (skinsHtml || '<span class="badge">无皮肤</span>') + '</div>';
        // 版本号
        var vb = el.querySelector('.version-badge');
        if (vb) vb.textContent = 'v' + (node.version || '?');
    }
    // 刷新骨骼标记和循环按钮
    SMTool._refreshBoneTagsUI(node);
    var loopBtn = el.querySelector('.loop-toggle');
    if (loopBtn) {
        loopBtn.textContent = node.loop !== false ? '🔄 循环播放' : '▶ 单次播放';
        loopBtn.classList.toggle('active', node.loop !== false);
    }

    // 标题（显示原始英文动画名，而非翻译后的 node.name）
    var hn = el.querySelector('.header .name');
    if (hn) { var displayName = node.currentAnim || node.name; hn.textContent = displayName; hn.title = displayName; }
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

    // 刷新轨道面板
    SMTool._refreshTrackPanel(node);

    // ★ 刷新顶部指示图标
    var indEl = el.querySelector('.node-indicators');
    if (indEl) {
        indEl.outerHTML = SMTool._buildNodeIndicatorsHtml(node);
    }

    // ★ 同步状态描述框内容 + 自动撑开高度（替换文件后 _createEl 不会重新执行）
    var stateDescTa = el.querySelector('.state-desc');
    if (stateDescTa) {
        var curVal = stateDescTa.value;
        var newVal = node._stateDesc || '';
        if (curVal !== newVal) stateDescTa.value = newVal;
        if (newVal.trim().length > 0) {
            stateDescTa.classList.add('has-content');
        } else {
            stateDescTa.classList.remove('has-content');
        }
        // 延迟撑开（等浏览器完成文本布局）
        (function (ta) {
            setTimeout(function () {
                ta.style.height = '0px';
                ta.style.height = ta.scrollHeight + 'px';
            }, 0);
        })(stateDescTa);
    }
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
    var nodeScale = (node._customScale !== undefined ? node._customScale : 1.0);
    var totalScale = z * nodeScale;
    var s = SMTool.worldToDOM(node.x, node.y);
    el.style.left = s.x + 'px';
    el.style.top = s.y + 'px';
    el.style.transform = 'scale(' + totalScale + ')';
    el.style.transformOrigin = 'top left';

    SMTool._updateFloatLabels();
};

// ★ 优化：rAF 批量合并，避免同一帧内多次全量刷新
SMTool._allPosScheduled = false;
SMTool._allPosQueued = false;

// ★ 核心：同步更新所有节点 DOM 位置（缩放/平移时使用，避免连线偏移）
SMTool._updateAllPosCore = function () {
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        SMTool._updatePos(result.value);
        result = nodesIter.next();
    }

    // 连线端口：画布缩小时放大，放大时缩小，但保持最小可见
    var z = SMData.view.zoom;
    var dotScale = Math.max(0.25, Math.min(2, 2 - z));
    var dots = document.querySelectorAll('.spine-node .conn-dot');
    for (var i = 0; i < dots.length; i++) {
        dots[i].style.transform = 'scale(' + dotScale + ')';
    }

    SMTool._updateFloatLabels();
};

SMTool._updateAllPos = function (forceSync) {
    // ★ 缩放/平移操作必须同步更新 DOM，否则下一帧 _renderConnections
    // 会用新 zoom 读取旧 DOM 位置（getBoundingClientRect），算出错误世界坐标导致连线偏移
    if (forceSync) {
        // 清除待处理的异步更新（本次同步已覆盖）
        SMTool._allPosScheduled = false;
        SMTool._allPosQueued = false;
        SMTool._updateAllPosCore();
        return;
    }

    // ★ 如果已经安排了 rAF，标记排队即可
    if (SMTool._allPosScheduled) { SMTool._allPosQueued = true; return; }
    SMTool._allPosScheduled = true;

    requestAnimationFrame(function () {
        SMTool._allPosScheduled = false;
        SMTool._allPosQueued = false;

        SMTool._updateAllPosCore();

        // ★ 如果排队期间又有新请求，再次调度
        if (SMTool._allPosQueued) SMTool._updateAllPos();
    });
};

// ---- 浮动大字标签（缩放 < 40% 时显示，固定字号不随缩放放大）----
SMTool._floatLabels = {};

SMTool._updateFloatLabels = function () {
    var container = document.getElementById('floatLabels');
    if (!container) return;
    var z = SMData.view.zoom;
    var show = z < 0.25;
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
                // ★ 可编辑翻译名（双击修改，与标题节点行为一致）
                var nameSpan = document.createElement('span');
                nameSpan.className = 'fl-name';
                nameSpan.contentEditable = 'false';
                nameSpan.addEventListener('dblclick', function(e) {
                    e.stopPropagation();
                    this.contentEditable = 'true';
                    this.focus();
                    document.execCommand('selectAll');
                });
                nameSpan.addEventListener('blur', function() {
                    this.contentEditable = 'false';
                    var nid = parseInt(this.parentNode.getAttribute('data-nid'));
                    var newNode = SMData.nodes.get(nid);
                    if (newNode) { newNode.name = this.innerText.trim() || newNode.name; }
                });
                nameSpan.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape') this.blur();
                });
                label.appendChild(nameSpan);
                // 状态名（不可编辑）
                var stateSpan = document.createElement('span');
                stateSpan.className = 'fl-state';
                label.appendChild(stateSpan);
                container.appendChild(label);
                SMTool._floatLabels[node.id] = label;
            }
            label.setAttribute('data-nid', node.id);
            label.style.display = '';

            var sp = SMTool.worldToCanvas(node.x, node.y);
            var fontSize = 15;
            label.style.left = sp.x + 'px';
            label.style.top = (sp.y - fontSize * 2) + 'px';
            label.style.fontSize = fontSize + 'px';

            // ★ 第一排显示原始英文状态名（不翻译），第二排显示文件名
            var nameSpan2 = label.querySelector('.fl-name');
            var stateSpan2 = label.querySelector('.fl-state');
            if (nameSpan2 && nameSpan2.contentEditable !== 'true') {
                nameSpan2.textContent = node.currentAnim || '';
            }
            if (stateSpan2) {
                stateSpan2.textContent = node.sourceFile || '';
            }
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
    // ★ 同步 selectedNode 与 selectedNodes（防止不一致导致面板提示错误）
    if (SMData.selectedNodes.size === 1) {
        var onlyId = SMData.selectedNodes.values().next().value;
        if (SMData.selectedNode !== onlyId) SMData.selectedNode = onlyId;
    } else if (SMData.selectedNodes.size === 0) {
        SMData.selectedNode = null;
    }

    // 计算焦点集合
    var focusSet = new Set();
    // ★ 无选中节点时清除旧的流程焦点，避免残留高亮/变暗
    if (SMData._flowFocus && !SMData.selectedNode) {
        SMData._flowFocus = null;
    }
    if (SMData._flowFocus) {
        // 流程面板高亮模式：使用流程焦点节点
        SMData._flowFocus.nodeIds.forEach(function (nid) { focusSet.add(nid); });
    } else if (SMData.flowMode === 'full' && SMData.selectedNode) {
        // 完整动画组模式：自动设置全组件焦点
        SMTool._setFullComponentFocus(SMData.selectedNode);
        if (SMData._flowFocus) {
            SMData._flowFocus.nodeIds.forEach(function (nid) { focusSet.add(nid); });
        }
    } else if (SMData.connecting) {
        // 连线模式：仅高亮源节点
        focusSet.add(SMData.connecting.nodeId);
    } else if (SMData.selectedNodes.size >= 1) {
        var selIter = SMData.selectedNodes.values();
        var sr = selIter.next();
        while (!sr.done) {
            var selId = sr.value;
            focusSet.add(selId);
            for (var ci = 0; ci < SMData.connections.length; ci++) {
                var c = SMData.connections[ci];
                if (c.fromNode === selId) focusSet.add(c.toNode);
                if (c.toNode === selId) focusSet.add(c.fromNode);
            }
            sr = selIter.next();
        }
    }
    SMData._focusNodes = focusSet;

    // 连线时 input 端点变绿放大，output 端点缩小
    var alreadyConnected = new Set();
    if (SMData.connecting) {
        alreadyConnected.add(SMData.connecting.nodeId);
        for (var ci2 = 0; ci2 < SMData.connections.length; ci2++) {
            var c2 = SMData.connections[ci2];
            if (c2.fromNode === SMData.connecting.nodeId) alreadyConnected.add(c2.toNode);
        }
    }
    var allInputDots = document.querySelectorAll('.spine-node .anim-bar .conn-dot.input');
    for (var di = 0; di < allInputDots.length; di++) {
        var dot = allInputDots[di];
        var nodeEl = dot.closest('.spine-node');
        var nodeId = nodeEl ? parseInt(nodeEl.id.replace('sn-', '')) : 0;
        var shouldHighlight = !!SMData.connecting && !alreadyConnected.has(nodeId);
        dot.classList.toggle('connecting-target', shouldHighlight);
    }
    var allOutputDots = document.querySelectorAll('.spine-node .anim-bar .conn-dot.output');
    for (var do2 = 0; do2 < allOutputDots.length; do2++) {
        allOutputDots[do2].classList.toggle('connecting-shrink', !!SMData.connecting);
    }

    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        var el = SMTool._getEl(n.id);
        if (el) {
            el.classList.toggle('selected', SMData.selectedNodes.has(n.id));
            var isDimmed = focusSet.size > 0 && !focusSet.has(n.id);
            var isFocused = focusSet.size > 0 && focusSet.has(n.id) && !SMData.selectedNodes.has(n.id);
            el.classList.toggle('focused', isFocused);

            // 完整动画组播放中：当前步骤节点用粉色高亮
            var pb = SMData._fullPlayback;
            var isPlayingCurrent = false;
            if (pb.isPlaying && pb.activePathIdx >= 0) {
                var pp = SMData._fullPaths[pb.activePathIdx];
                if (pp && pb.currentStep < pp.nodes.length && pp.nodes[pb.currentStep].id === n.id) {
                    isPlayingCurrent = true;
                }
            }
            el.classList.toggle('playing-current', isPlayingCurrent);

            var overlay = el.querySelector('.dim-overlay');
            if (isDimmed && !overlay) {
                overlay = document.createElement('div');
                overlay.className = 'dim-overlay';
                el.appendChild(overlay);
            } else if (!isDimmed && overlay) {
                overlay.remove();
            }
            if (SMData.connecting && SMData.connecting.nodeId === n.id) {
                el.classList.add('connecting');
            } else {
                el.classList.remove('connecting');
            }
            // ★ 组编辑模式标记
            var editGrp = SMData._groupEditMode;
            if (editGrp) {
                var nGrp = SMTool._findGroupOf(n.id);
                el.classList.toggle('group-editing', !!(nGrp && nGrp.id === editGrp));
            } else {
                el.classList.remove('group-editing');
            }
        }
        result = nodesIter.next();
    }
    SMTool._updateFloatPanel();
    SMTool._updateFlowPanel();

    // ★ 多选 ≥2 时显示对齐排版工具栏
    var alignBar = document.getElementById('alignBar');
    if (alignBar) {
        alignBar.style.display = (SMData.selectedNodes.size >= 2) ? 'flex' : 'none';
    }

    // ★ 层级节点：选中时自动弹出浮窗预览 + 刷新框内文字
    if (SMData.selectedNodes.size === 1 && SMData.selectedNode) {
        var selNode = SMData.nodes.get(SMData.selectedNode);
        if (selNode && selNode.nodeType === 'layer') {
            // 强制刷新层级框文字（直接从连线表读取，三重兜底）
            var elL = SMTool._getEl(selNode.id);
            if (elL) {
                var boxesL = elL.querySelectorAll('.layer-box-text');
                var ldL = SMTool._layerData(selNode);
                for (var liL = 0; liL < boxesL.length; liL++) {
                    var lnumL = liL + 1;
                    var txt = '请连线动画节点';
                    var foundL = false;
                    // 兜底1：从连线表 _layerNum 匹配
                    for (var ciL = 0; ciL < SMData.connections.length; ciL++) {
                        var cL = SMData.connections[ciL];
                        if (cL.fromNode === selNode.id && cL._layerNum === lnumL) {
                            var tnL = SMData.nodes.get(cL.toNode);
                            if (tnL) { txt = (tnL.sourceFile || tnL.name || '动画节点') + (tnL.currentAnim ? ' — ' + tnL.currentAnim : ''); foundL = true; }
                            break;
                        }
                    }
                    // 兜底2：从连线表 fromState 解析层号
                    if (!foundL) {
                        for (var ciL2 = 0; ciL2 < SMData.connections.length; ciL2++) {
                            var cL2 = SMData.connections[ciL2];
                            if (cL2.fromNode === selNode.id && typeof cL2.fromState === 'string' && cL2.fromState === 'layer_' + lnumL) {
                                var tnL2a = SMData.nodes.get(cL2.toNode);
                                if (tnL2a) { txt = (tnL2a.sourceFile || tnL2a.name || '动画节点') + (tnL2a.currentAnim ? ' — ' + tnL2a.currentAnim : ''); foundL = true; break; }
                            }
                        }
                    }
                    // ★ 无连线则清除旧数据
                    if (!foundL && ldL.layers[lnumL]) delete ldL.layers[lnumL];
                    boxesL[liL].textContent = txt;
                    // ★ 同步 connected class
                    var boxElL = boxesL[liL].parentElement;
                    if (boxElL) boxElL.classList.toggle('connected', foundL);
                }
            }
            SMTool._showAnimPreview(selNode);
        }
    }
};

// ---- 清除节点面板缓存（截图/备注变更时调用）----
SMTool._invalidatePanelCache = function (nid) {
    if (nid !== undefined && nid !== null) {
        delete SMData._panelCache[nid];
    } else {
        SMData._panelCache = {};
    }
    if (SMData._lastPanelNodeId === nid || nid === undefined) {
        SMData._lastPanelNodeId = -1;
    }
};

// ================================================================
// ★ 右上角动画预览浮窗面板 — 显示/隐藏/拖拽/缩放
// ================================================================

// ---- 显示预览面板 ----
SMTool._showAnimPreview = function (node) {
    // ★ 层级节点：多层叠加预览
    if (node && node.nodeType === 'layer') {
        SMTool._showLayerPreview(node);
        return;
    }
    // 跳过非 Spine 节点
    if (!node || node.nodeType !== 'spine') return;
    // ★ 播放启动期间抑制中间态重建
    if (SMData._animPreview && SMData._animPreview._suppressShow) return;
    // 跳过无源数据的节点
    if (!node._srcAtlasText || !(node._srcSkelJson || node._srcSkelBinBase64)) return;
    // 跳过无动画的节点
    var allAnims = (node.animations && node.animations.length > 0)
        ? node.animations
        : (node.skeletonData && node.skeletonData.animations
            ? node.skeletonData.animations.map(function(a) { return { name: a.name }; })
            : []);
    var targetAnim = node.currentAnim;
    if (!targetAnim) {
        if (allAnims.length > 0) {
            targetAnim = allAnims[0].name;
        } else {
            return;
        }
    }
    // 验证动画是否存在于动画列表
    var animFound = false;
    for (var ai = 0; ai < allAnims.length; ai++) {
        if (allAnims[ai].name === targetAnim) { animFound = true; break; }
    }
    if (!animFound) return;

    var panel = document.getElementById('animPreviewPanel');
    if (!panel) return;

    var pp = SMData._animPreview;

    // ================================================================
    // 🔒🔒🔒 [LOCK-1] 每个动画文件独立预览缩放
    // ⚠️ 解锁策略：除非用户明确说「解锁 LOCK-1」，或我主动问询
    //    「是否解锁 LOCK-1 以修改XX功能」且用户同意，否则绝不改动此块。
    //
    // _previewZooms[sourceFile] 记录每文件缩放值，点击节点查表恢复，
    // 无记录默认100%。滚轮缩放回写 _previewZooms。同源切换必须同步相机。
    // 联动位置：1)此处加载 2)wheel保存 3)_resetAnimPreviewZoom 4)_syncAnimPreviewViewport
    // ================================================================
    var fileZoom = SMData._previewZooms && SMData._previewZooms[node.sourceFile];
    pp._contentZoom = (fileZoom !== undefined) ? fileZoom : 1.0;
    // 🔒 [LOCK-1] END

    // 🔒 [LOCK-3] 节点被点击时解除 flow 暂停冻结
    if (pp._flowFrozen) pp._flowFrozen = false;

    // ★ 如果同一节点已显示 → 同步动画、PMA、皮肤
    if (pp.visible && pp.nodeId === node.id && pp.skeleton && pp.state) {
        if (pp.animName !== targetAnim) {
            SMTool._updateAnimPreviewAnim(targetAnim);
        }
        SMTool._syncPreviewPmaAndSkin(pp, node);
        return;
    }

    // ★ 如果同源文件（同骨架）但不同节点 → 仅切换动画，不重建 GL
    var sameSource = pp.visible && pp.skeleton && pp._skeletonData &&
        node._srcAtlasText === pp._atlasData ? true : false;
    // 简化检测：比较源文件名
    if (!sameSource && pp.visible && pp.skeleton && node.sourceFile) {
        var existingNode = SMData.nodes.get(pp.nodeId);
        if (existingNode && existingNode.sourceFile === node.sourceFile) {
            sameSource = true;
        }
    }

    if (sameSource) {
        pp.nodeId = node.id;
        var title = document.getElementById('appTitle');
        if (title) title.textContent = '🎬 ' + targetAnim;
        if (pp.animName !== targetAnim) {
            SMTool._updateAnimPreviewAnim(targetAnim);
        }
        // ★ 同步 PMA 和皮肤（同源不同节点时可能不一致）
        SMTool._syncPreviewPmaAndSkin(pp, node);
        // ★ 同步相机（确保缩放值匹配当前文件的记录）
        SMTool._syncAnimPreviewViewport(pp, pp._canvasWidth || pp.panelW, pp._canvasHeight || pp.panelH);
        return;
    }

    // ★ 完全不同 → 完整重建
    panel.style.display = 'flex';
    pp.visible = true;

    // 恢复上次位置/尺寸或使用默认值
    if (pp.panelX && pp.panelY) {
        panel.style.left = pp.panelX + 'px';
        panel.style.top = pp.panelY + 'px';
        panel.style.right = 'auto';
    } else {
        panel.style.left = 'auto';
        panel.style.right = '16px';
        panel.style.top = '16px';
    }
    if (pp.panelW && pp.panelH) {
        panel.style.width = pp.panelW + 'px';
        panel.style.height = pp.panelH + 'px';
    }

    // 初始化 Spine 渲染
    SMTool._initAnimPreview(node);
};

// ---- 隐藏预览面板 ----
SMTool._hideAnimPreview = function () {
    var panel = document.getElementById('animPreviewPanel');
    if (panel) panel.style.display = 'none';

    SMTool._destroyAnimPreview();
    SMData._animPreview.visible = false;
};

// ---- 初始化预览面板拖拽与缩放事件 ----
SMTool._initAnimPreviewPanel = function () {
    var panel = document.getElementById('animPreviewPanel');
    if (!panel) return;

    var header = panel.querySelector('.app-header');
    var resizeHandle = panel.querySelector('.app-resize-handle');
    var pp = SMData._animPreview;

    // 整个面板可拖拽（排除关闭按钮和缩放手柄；canvas 区域也可拖拽，滚轮仍用于缩放）
    panel.addEventListener('mousedown', function (e) {
        if (e.target.closest('.app-close')) return;
        if (e.target.closest('.app-resize-handle')) return;
        e.preventDefault();
        e.stopPropagation();
        var rect = panel.getBoundingClientRect();
        var startX = e.clientX;
        var startY = e.clientY;
        var startLeft = rect.left;
        var startTop = rect.top;

        function onMove(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            var dx = ev.clientX - startX;
            var dy = ev.clientY - startY;
            var newLeft = startLeft + dx;
            var newTop = startTop + dy;
            newLeft = Math.max(0, Math.min(window.innerWidth - rect.width, newLeft));
            newTop = Math.max(0, Math.min(window.innerHeight - 30, newTop));
            panel.style.left = newLeft + 'px';
            panel.style.top = newTop + 'px';
            panel.style.right = 'auto';
            pp.panelX = newLeft;
            pp.panelY = newTop;
        }

        function onUp(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            panel.style.cursor = '';
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        panel.style.cursor = 'move';
    });

    // 右下角缩放手柄
    if (resizeHandle) {
        resizeHandle.addEventListener('mousedown', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var startX = e.clientX;
            var startY = e.clientY;
            var startW = panel.offsetWidth;
            var startH = panel.offsetHeight;

            function onMove(ev) {
                var dx = ev.clientX - startX;
                var dy = ev.clientY - startY;
                var newW = Math.max(200, startW + dx);
                var newH = Math.max(200, startH + dy);
                panel.style.width = newW + 'px';
                panel.style.height = newH + 'px';
                pp.panelW = newW;
                pp.panelH = newH;
                // 同步 canvas 尺寸并更新视口（相机/投影/骨架位置重新计算）
                var canvas = document.getElementById('appCanvas');
                if (canvas) {
                    // ★ 层级预览使用专用路径（等比例），普通预览使用通用路径
                    if (pp._layerSkeletons && pp._layerSkeletons.length > 0) {
                        SMTool._syncLayerPreviewViewport(pp, newW, newH);
                    } else {
                        SMTool._syncAnimPreviewViewport(pp, newW, newH);
                    }
                }
            }

            function onUp() {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // 面板内鼠标滚轮 → 缩放 Spine 动画内容
    panel.addEventListener('wheel', function (e) {
        if (!pp.visible || !pp.gl) return;
        if (!pp.skeleton && !(pp._layerSkeletons && pp._layerSkeletons.length > 0)) return;
        e.preventDefault();
        e.stopPropagation();
        pp._contentZoom = pp._contentZoom || 1.0;
        var factor = e.deltaY > 0 ? 0.9 : 1.1;
        pp._contentZoom = Math.max(0.1, Math.min(10, pp._contentZoom * factor));
        // 🔒 [LOCK-1] 滚轮缩放回写到文件记录
        var sourceNode = SMData.nodes.get(pp.nodeId);
        if (sourceNode && sourceNode.sourceFile) {
            SMData._previewZooms[sourceNode.sourceFile] = pp._contentZoom;
        }
        // ★ 层级预览缩放也持久化（key = '_layer_' + nodeId）
        if (pp._layerSkeletons && pp._layerSkeletons.length > 0 && pp.nodeId) {
            SMData._previewZooms['_layer_' + pp.nodeId] = pp._contentZoom;
        }
        // ★ 层级预览：更新每层的 MVP
        if (pp._layerSkeletons && pp._layerSkeletons.length > 0) {
            SMTool._syncLayerPreviewViewport(pp);
        } else {
            SMTool._syncAnimPreviewViewport(pp, pp._canvasWidth || pp.panelW, pp._canvasHeight || pp.panelH);
        }
    }, { passive: false });
};

// ---- 更新左侧浮窗面板数据 ----（页签式布局：皮肤 | 骨骼 | 插槽 | 信息）
SMTool._updateFloatPanel = function () {
    var content = document.getElementById('dfpContent');
    var tabsEl = document.getElementById('dfpTabs');
    var footer = document.getElementById('dfpFooter');
    var panel = document.getElementById('dataFloatPanel');
    if (!content || !panel || !tabsEl || !footer) return;

    // 辅助：构建 PMA 按钮 HTML（单选）
    var _pmaBtnHtml = function (node, isMulti, allPma) {
        if (isMulti) {
            var checkedStr = (allPma === true) ? ' active' : '';
            var pmaIcon2 = (allPma === true) ? '🔴' : (allPma === 'mixed' ? '🟡' : '⚪');
            var pmaStatus2 = (allPma === true) ? '已开启' : (allPma === 'mixed' ? '混合状态' : '已关闭');
            var pmaToggleVal = (allPma === true) ? false : true;
            return '<button class="dfp-pma-toggle-btn' + checkedStr + '" onclick="SMTool._toggleMultiPMA(' + pmaToggleVal + ')">' +
                '<span class="pma-icon">' + pmaIcon2 + '</span>' +
                '<span>预乘 Alpha</span>' +
                '<span class="pma-status">' + pmaStatus2 + '</span>' +
            '</button>';
        }
        return '<button class="dfp-pma-toggle-btn' + (node.premultipliedAlpha ? ' active' : '') + '" onclick="SMTool._togglePMA(' + node.id + ',' + !node.premultipliedAlpha + ')">' +
            '<span class="pma-icon">' + (node.premultipliedAlpha ? '🔴' : '⚪') + '</span>' +
            '<span>预乘 Alpha</span>' +
            '<span class="pma-status">' + (node.premultipliedAlpha ? '已开启' : '已关闭') + '</span>' +
        '</button>';
    };

    // 仅当单选一个节点时显示数据
    if (SMData.selectedNodes.size === 1 && SMData.selectedNode) {
        panel.classList.remove('inactive');
        var node = SMData.nodes.get(SMData.selectedNode);
        if (!node) {
            content.innerHTML = '<div class="dfp-hint">未找到节点数据</div>';
            tabsEl.innerHTML = '';
            footer.innerHTML = '';
            SMData._lastPanelNodeId = -1;
            return;
        }

        // ★ 性能优化：同一节点数据未变 → 跳过重建
        if (SMData._lastPanelNodeId === node.id) {
            return;
        }
        SMData._lastPanelNodeId = node.id;

        // 入口/出口节点显示简化面板（无页签）
        if (node.nodeType === 'entry') {
            tabsEl.innerHTML = '';
            footer.innerHTML = '';
            content.innerHTML =
                '<div class="dfp-section"><div class="dfp-section-title">🚪 入口节点</div><div class="dfp-row">' + SMTool._esc(node.name) + '</div></div>' +
                '<div class="dfp-section"><div class="dfp-section-title">📌 说明</div><div class="dfp-row">状态机的起始入口，从此节点开始连线到其他状态。</div></div>';
            return;
        }
        if (node.nodeType === 'exit') {
            tabsEl.innerHTML = '';
            footer.innerHTML = '';
            content.innerHTML =
                '<div class="dfp-section"><div class="dfp-section-title">🏁 出口节点</div><div class="dfp-row">' + SMTool._esc(node.name) + '</div></div>' +
                '<div class="dfp-section"><div class="dfp-section-title">📝 出口文本</div><div class="dfp-row">' + SMTool._esc(node._exitText || '(空)') + '</div></div>' +
                '<div class="dfp-section"><div class="dfp-section-title">📌 说明</div><div class="dfp-row">状态机的结束节点，其他状态可连线到此。</div></div>';
            return;
        }

        // ===== 构建各页签内容 =====

        // --- 皮肤 ---
        var skinRows = '';
        for (var si = 0; si < node.skins.length; si++) {
            skinRows += SMTool._buildSkinRowHtml(node, node.skins[si]);
        }
        if (!skinRows) skinRows = '<div class="dfp-row">无</div>';

        // --- 骨骼 ---
        var boneRows = '';
        for (var bi = 0; bi < node.bones.length; bi++) {
            boneRows += SMTool._buildBoneRowHtml(node, node.bones[bi]);
        }
        if (!boneRows) boneRows = '<div class="dfp-row">无</div>';

        // --- 插槽 ---
        var slotRows = '';
        for (var sli = 0; sli < node.slots.length; sli++) {
            slotRows += SMTool._buildSlotRowHtml(node, node.slots[sli]);
        }
        if (!slotRows) slotRows = '<div class="dfp-row">无</div>';

        // --- 信息 ---
        var infoHtml = '<div class="dfp-section"><div class="dfp-section-title">🏷️ 节点名称</div><div class="dfp-row">' + SMTool._esc(node.name) + '</div></div>';
        if (node._srcFileNames && node._srcFileNames.length > 0) {
            var sfRows = '';
            for (var sfi = 0; sfi < node._srcFileNames.length; sfi++) {
                sfRows += '<div class="dfp-row" style="word-break:break-all;font-size:11px">' + SMTool._esc(node._srcFileNames[sfi]) + '</div>';
            }
            infoHtml += '<div class="dfp-section"><div class="dfp-section-title">📁 源文件 (' + node._srcFileNames.length + ')</div>' + sfRows + '</div>';
        } else if (node.sourceFile) {
            infoHtml += '<div class="dfp-section"><div class="dfp-section-title">📁 源文件</div><div class="dfp-row" style="word-break:break-all">' + SMTool._esc(node.sourceFile) + '</div></div>';
        }
        infoHtml += '<div class="dfp-section"><div class="dfp-section-title">📦 Spine 版本</div><div class="dfp-row"><span>版本</span><span>' + SMTool._esc(node.version || '未知') + '</span></div></div>';
        var animsHtml = '';
        for (var ai = 0; ai < node.animations.length; ai++) {
            var a = node.animations[ai];
            var isActive = node.currentAnim === a.name;
            animsHtml += '<div class="dfp-row' + (isActive ? ' active' : '') + '"><span>' + SMTool._esc(a.name) + '</span><span>' + a.duration.toFixed(2) + 's</span></div>';
        }
        if (!animsHtml) animsHtml = '<div class="dfp-row">无</div>';
        infoHtml += '<div class="dfp-section"><div class="dfp-section-title">🎬 动画 (' + node.animations.length + ')</div>' + animsHtml + '</div>';

        // ★ 骨骼/皮肤/插槽/事件帧页签红点：有内容时显示
        var skinDotHtml = SMTool._hasSkinContent(node) ? '<span class="dfp-tab-dot"></span>' : '';
        var boneDotHtml = SMTool._hasBoneContent(node) ? '<span class="dfp-tab-dot"></span>' : '';
        var slotDotHtml = SMTool._hasSlotContent(node) ? '<span class="dfp-tab-dot"></span>' : '';
        var eventDotHtml = SMTool._hasEventContent(node) ? '<span class="dfp-tab-dot"></span>' : '';

        // ===== 渲染页签栏 =====
        tabsEl.innerHTML =
            '<button class="dfp-tab-btn" data-tab="skin" onclick="SMTool._switchPanelTab(\'skin\')">' +
                '🎨 皮肤 <span class="dfp-tab-count">' + node.skins.length + '</span>' + skinDotHtml +
            '</button>' +
            '<button class="dfp-tab-btn" data-tab="bone" onclick="SMTool._switchPanelTab(\'bone\')">' +
                '🦴 骨骼 <span class="dfp-tab-count">' + node.bones.length + '</span>' + boneDotHtml +
            '</button>' +
            '<button class="dfp-tab-btn" data-tab="event" onclick="SMTool._switchPanelTab(\'event\')">' +
                '⚡ 事件帧' + eventDotHtml +
            '</button>' +
            '<button class="dfp-tab-btn" data-tab="slot" onclick="SMTool._switchPanelTab(\'slot\')">' +
                '� 插槽 <span class="dfp-tab-count">' + node.slots.length + '</span>' + slotDotHtml +
            '</button>' +
            '<button class="dfp-tab-btn" data-tab="info" onclick="SMTool._switchPanelTab(\'info\')">' +
                '📋 信息' +
            '</button>';

        // ===== 渲染页签内容 =====
        var eventHtml = SMTool._buildEventFramesHtml(node);
        content.innerHTML =
            '<div class="dfp-tab-panel" data-panel="skin">' + skinRows + '</div>' +
            '<div class="dfp-tab-panel" data-panel="bone">' + boneRows + '</div>' +
            '<div class="dfp-tab-panel" data-panel="event">' + eventHtml + '</div>' +
            '<div class="dfp-tab-panel" data-panel="slot">' + slotRows + '</div>' +
            '<div class="dfp-tab-panel" data-panel="info">' + infoHtml + '</div>';

        // ===== 渲染底部循环播放 + 预乘Alpha 按钮（固定不随页签切换） =====
        SMTool._updateBottomBar();

        // ===== 激活当前页签 =====
        SMTool._switchPanelTab(SMData._activePanelTab || 'skin');

        // ★ 刷新当前节点的指示图标
        var nEl2 = SMTool._getEl(node.id);
        if (nEl2) {
            var indEl2 = nEl2.querySelector('.node-indicators');
            if (indEl2) indEl2.outerHTML = SMTool._buildNodeIndicatorsHtml(node);
        }

    } else if (SMData.selectedNodes.size > 1) {
        // 多选时，检查是否同一源文件
        var sampleNode = null;
        var sameFile = true;
        var firstFile = null;
        var activeAnims = {};  // { animName: true }
        var allPma = null;
        SMData.selectedNodes.forEach(function (nid) {
            var n = SMData.nodes.get(nid);
            if (!n) return;
            if (!sampleNode) { sampleNode = n; firstFile = n.sourceFile; }
            if (n.sourceFile !== firstFile) sameFile = false;
            if (n.currentAnim) activeAnims[n.currentAnim] = true;
            if (allPma === null) allPma = n.premultipliedAlpha;
            else if (allPma !== n.premultipliedAlpha) allPma = 'mixed';
        });

        if (sameFile && sampleNode && sampleNode.sourceFile) {
            panel.classList.remove('inactive');
            var node2 = sampleNode;

            // --- 皮肤 ---
            var skinRows2 = '';
            for (var si2 = 0; si2 < node2.skins.length; si2++) {
                skinRows2 += SMTool._buildSkinRowHtml(node2, node2.skins[si2]);
            }
            if (!skinRows2) skinRows2 = '<div class="dfp-row">无</div>';

            // --- 骨骼 ---
            var boneRows2 = '';
            for (var bi2 = 0; bi2 < node2.bones.length; bi2++) {
                boneRows2 += SMTool._buildBoneRowHtml(node2, node2.bones[bi2]);
            }
            if (!boneRows2) boneRows2 = '<div class="dfp-row">无</div>';

            // --- 插槽 ---
            var slotRows2 = '';
            for (var sli2 = 0; sli2 < node2.slots.length; sli2++) {
                slotRows2 += SMTool._buildSlotRowHtml(node2, node2.slots[sli2]);
            }
            if (!slotRows2) slotRows2 = '<div class="dfp-row">无</div>';

            // --- 信息 ---
            var infoHtml2 = '<div class="dfp-section"><div class="dfp-section-title">🏷️ 已选 ' + SMData.selectedNodes.size + ' 个节点（同源）</div></div>';
            infoHtml2 += '<div class="dfp-section"><div class="dfp-section-title">📦 Spine 版本</div><div class="dfp-row"><span>版本</span><span>' + SMTool._esc(node2.version || '未知') + '</span></div></div>';
            var animsHtml2 = '';
            for (var ai2 = 0; ai2 < node2.animations.length; ai2++) {
                var a2 = node2.animations[ai2];
                var isActive2 = !!activeAnims[a2.name];
                animsHtml2 += '<div class="dfp-row' + (isActive2 ? ' active' : '') + '"><span>' + SMTool._esc(a2.name) + '</span><span>' + a2.duration.toFixed(2) + 's</span></div>';
            }
            if (!animsHtml2) animsHtml2 = '<div class="dfp-row">无</div>';
            infoHtml2 += '<div class="dfp-section"><div class="dfp-section-title">🎬 动画 (' + node2.animations.length + ')</div>' + animsHtml2 + '</div>';

            // ★ 骨骼/皮肤/插槽/事件帧页签红点
            var skinDotHtml2 = SMTool._hasSkinContent(node2) ? '<span class="dfp-tab-dot"></span>' : '';
            var boneDotHtml2 = SMTool._hasBoneContent(node2) ? '<span class="dfp-tab-dot"></span>' : '';
            var slotDotHtml2 = SMTool._hasSlotContent(node2) ? '<span class="dfp-tab-dot"></span>' : '';
            var eventDotHtml2 = SMTool._hasEventContent(node2) ? '<span class="dfp-tab-dot"></span>' : '';

            // 渲染
            tabsEl.innerHTML =
                '<button class="dfp-tab-btn" data-tab="skin" onclick="SMTool._switchPanelTab(\'skin\')">' +
                    '🎨 皮肤 <span class="dfp-tab-count">' + node2.skins.length + '</span>' + skinDotHtml2 +
                '</button>' +
                '<button class="dfp-tab-btn" data-tab="bone" onclick="SMTool._switchPanelTab(\'bone\')">' +
                    '🦴 骨骼 <span class="dfp-tab-count">' + node2.bones.length + '</span>' + boneDotHtml2 +
                '</button>' +
                '<button class="dfp-tab-btn" data-tab="event" onclick="SMTool._switchPanelTab(\'event\')">' +
                    '⚡ 事件帧' + eventDotHtml2 +
                '</button>' +
                '<button class="dfp-tab-btn" data-tab="slot" onclick="SMTool._switchPanelTab(\'slot\')">' +
                    '� 插槽 <span class="dfp-tab-count">' + node2.slots.length + '</span>' + slotDotHtml2 +
                '</button>' +
                '<button class="dfp-tab-btn" data-tab="info" onclick="SMTool._switchPanelTab(\'info\')">' +
                    '📋 信息' +
                '</button>';
            var eventHtml2 = SMTool._buildEventFramesHtml(node2);
            content.innerHTML =
                '<div class="dfp-tab-panel" data-panel="skin">' + skinRows2 + '</div>' +
                '<div class="dfp-tab-panel" data-panel="bone">' + boneRows2 + '</div>' +
                '<div class="dfp-tab-panel" data-panel="event">' + eventHtml2 + '</div>' +
                '<div class="dfp-tab-panel" data-panel="slot">' + slotRows2 + '</div>' +
                '<div class="dfp-tab-panel" data-panel="info">' + infoHtml2 + '</div>';
            SMTool._updateBottomBar();

            SMTool._switchPanelTab(SMData._activePanelTab || 'skin');
        } else {
            panel.classList.add('inactive');
            tabsEl.innerHTML = '';
            content.innerHTML = '<div class="dfp-hint">已多选 ' + SMData.selectedNodes.size + ' 个节点</div>';
            footer.innerHTML = '';
            SMData._lastPanelNodeId = -1;
        }
    } else {
        panel.classList.add('inactive');
        tabsEl.innerHTML = '';
        content.innerHTML = '<div class="dfp-hint">点击一个 Spine 节点以查看其动画数据</div>';
        footer.innerHTML = '';
        SMData._lastPanelNodeId = -1;
    }
};

// ---- 切换数据面板页签 ----
SMTool._switchPanelTab = function (tabName) {
    SMData._activePanelTab = tabName;
    var tabsEl = document.getElementById('dfpTabs');
    var content = document.getElementById('dfpContent');
    if (!tabsEl || !content) return;
    // 更新页签按钮状态
    var btns = tabsEl.querySelectorAll('.dfp-tab-btn');
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === tabName);
    }
    // 更新内容面板显示
    var panels = content.querySelectorAll('.dfp-tab-panel');
    for (var j = 0; j < panels.length; j++) {
        panels[j].classList.toggle('active', panels[j].getAttribute('data-panel') === tabName);
    }
};

// ================================================================
// ★ 提取动画中的事件帧数据（兼容 Spine 3.8 / 4.x）
// ================================================================
SMTool._buildEventFramesHtml = function (node) {
    if (!node || !node.skeletonData) return '<div class="dfp-row">无骨架数据</div>';
    var animName = node.currentAnim || (node.animations.length > 0 ? node.animations[0].name : '');
    if (!animName) return '<div class="dfp-row">无当前动画</div>';

    var sd = node.skeletonData;
    var anim = null;
    for (var ai = 0; ai < sd.animations.length; ai++) {
        if (sd.animations[ai].name === animName) { anim = sd.animations[ai]; break; }
    }
    if (!anim) return '<div class="dfp-row">动画 "' + SMTool._esc(animName) + '" 未找到</div>';

    // 提取事件时间线
    var eventEntries = [];
    var timelines = anim.timelines || (typeof anim.getTimelines === 'function' ? anim.getTimelines() : []);
    for (var ti = 0; ti < timelines.length; ti++) {
        var tl = timelines[ti];
        var frames = tl.frames;
        var events = tl.events;
        if (!frames || !events) continue;
        for (var fi = 0; fi < events.length; fi++) {
            var evt = events[fi];
            var evtName = evt.data ? evt.data.name : (evt.name || '');
            if (!evtName) continue;
            var time = (frames[fi] !== undefined) ? frames[fi] : 0;
            eventEntries.push({
                time: time,
                name: evtName,
                intValue: evt.intValue !== undefined ? evt.intValue : (evt.data ? evt.data.intValue : 0),
                floatValue: evt.floatValue !== undefined ? evt.floatValue : (evt.data ? evt.data.floatValue : 0),
                stringValue: evt.stringValue || (evt.data ? evt.data.stringValue : '') || ''
            });
        }
    }
    if (eventEntries.length === 0) {
        return '<div class="dfp-row" style="color:var(--text2)">动画 "' + SMTool._esc(animName) + '" 无事件帧</div>';
    }
    eventEntries.sort(function (a, b) { return a.time - b.time; });

    // ★ 生成可展开的事件行（含备注和截图，无淡入淡出和标记功能）
    var html = '<div class="dfp-section"><div class="dfp-section-title">⚡ ' + SMTool._esc(animName) + ' 事件帧 (' + eventEntries.length + ')</div>';
    for (var ei = 0; ei < eventEntries.length; ei++) {
        var e = eventEntries[ei];
        var evtName = e.name;
        // ★ 默认展开，只有用户手动收起才折叠
        var isExpanded = !(node._eventExpanded && node._eventExpanded[evtName] === false);
        var arrowIcon = isExpanded ? '▼' : '▶';
        var noteText = (node._eventNotes && node._eventNotes[evtName]) ? node._eventNotes[evtName] : '';
        var shots = (node._eventScreenshots && node._eventScreenshots[evtName]) ? node._eventScreenshots[evtName] : [];
        if (!Array.isArray(shots)) shots = shots ? [shots] : [];
        var hasContent = shots.length > 0 || noteText.trim().length > 0;

        var previewBadges = '';
        if (shots.length > 0) previewBadges += '<span class="dfp-bone-badge" title="' + shots.length + ' 张截图">📷' + shots.length + '</span>';
        if (noteText.trim().length > 0) previewBadges += '<span class="dfp-bone-badge" title="有备注">📝</span>';

        html += '<div class="dfp-row dfp-bone-row' + (isExpanded ? ' expanded' : '') + '" data-bone="' + SMTool._esc(evtName) + '" onclick="SMTool._toggleEventExpand(\'' + SMTool._esc(evtName) + '\')" style="cursor:pointer">' +
            '<span class="dfp-bone-name">' +
                '<span class="dfp-event-time">' + e.time.toFixed(2) + 's</span> ' + SMTool._esc(evtName) + previewBadges +
            '</span>' +
            '<span class="dfp-bone-right"><span class="dfp-event-arrow' + (hasContent ? ' has-content' : '') + '">' + arrowIcon + '</span></span>' +
            '<span class="dfp-bone-right"></span>' +
        '</div>';

        if (isExpanded) {
            var noteTextEsc = SMTool._esc(noteText);
            var shotsHtml = '';
            for (var si = 0; si < shots.length; si++) {
                var shotVal = shots[si];
                var isNewFormat = (typeof shotVal === 'number');
                if (isNewFormat) {
                    var shotSrc = SMData._shotGetThumb(shotVal);
                    if (!shotSrc) shotSrc = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="0 0 128 96"><rect fill="%232a2a35" width="128" height="96"/><text fill="%23666" x="64" y="52" text-anchor="middle" font-size="12">📷 ' + (si + 1) + '</text></svg>');
                    shotsHtml += '<div class="dfp-shot-item" onclick="event.stopPropagation();">' +
                        '<img src="' + shotSrc + '" alt="截图' + (si + 1) + '">' +
                        '<span class="dfp-shot-del" onclick="event.stopPropagation();SMTool._removeEventScreenshot(\'' + SMTool._esc(evtName) + '\',' + si + ')" title="删除此截图">×</span>' +
                    '</div>';
                } else {
                    shotsHtml += '<div class="dfp-shot-item" onclick="event.stopPropagation();">' +
                        '<img src="' + shotVal + '" alt="截图' + (si + 1) + '">' +
                        '<span class="dfp-shot-del" onclick="event.stopPropagation();SMTool._removeEventScreenshot(\'' + SMTool._esc(evtName) + '\',' + si + ')" title="删除此截图">×</span>' +
                    '</div>';
                }
            }
            html += '<div class="dfp-bone-note-area show" data-bone-note="' + SMTool._esc(evtName) + '">' +
                '<textarea placeholder="事件备注..." oninput="SMTool._updateEventNote(\'' + SMTool._esc(evtName) + '\', this.value)" onclick="event.stopPropagation()">' + noteTextEsc + '</textarea>' +
                '<div class="dfp-bone-shot-area show">' +
                    '<div class="dfp-shot-list">' + shotsHtml + '</div>' +
                    '<div class="dfp-shot-actions">' +
                        '<button class="dfp-shot-add" onclick="event.stopPropagation();SMTool._pickEventScreenshot(\'' + SMTool._esc(evtName) + '\')" ondragover="event.preventDefault();event.stopPropagation()" ondrop="event.preventDefault();event.stopPropagation();SMTool._dropEventScreenshot(event,\'' + SMTool._esc(evtName) + '\')" title="选取图片 / 拖入图片">📁 选取图片</button>' +
                        '<button class="dfp-shot-add dfp-shot-btn-paste" onclick="event.stopPropagation();SMTool._pasteScreenshot(\'' + SMTool._esc(evtName) + '\',\'event\')" title="先点此按钮，再按 Ctrl+V 粘贴剪贴板截图">📋 粘贴截图</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }
    }
    html += '</div>';
    return html;
};

// ---- 更新底部 PMA 按钮（不重建整个面板，保持当前页签） ----
SMTool._updateBottomBar = function () {
    var footer = document.getElementById('dfpFooter');
    if (!footer) return;
    var node = SMData.nodes.get(SMData.selectedNode);
    if (!node) { footer.innerHTML = ''; return; }

    // 构建循环播放按钮
    var loopBtnHtml = '<button class="dfp-bottom-loop-btn' + (node.loop !== false ? ' active' : '') + '" onclick="event.stopPropagation();SMTool._toggleLoop(' + node.id + ')" title="切换循环/单次播放">' +
        (node.loop !== false ? '🔄 循环' : '▶ 单次') + '</button>';

    // 多选时
    if (SMData.selectedNodes.size > 1) {
        var allPma = null;
        SMData.selectedNodes.forEach(function (nid) {
            var n = SMData.nodes.get(nid);
            if (!n) return;
            if (allPma === null) allPma = n.premultipliedAlpha;
            else if (allPma !== n.premultipliedAlpha) allPma = 'mixed';
        });
        var checkedStr = (allPma === true) ? ' active' : '';
        var pmaBtnHtml = '<button class="dfp-bottom-pma-btn' + checkedStr + '" onclick="SMTool._toggleMultiPMA(' + (allPma === true ? false : true) + ')" title="预乘 Alpha">' +
            (allPma === true ? '🔴 Alpha' : (allPma === 'mixed' ? '🟡 Alpha' : '⚪ Alpha')) + '</button>';
        footer.innerHTML = loopBtnHtml + pmaBtnHtml;
        return;
    }

    // 单选
    var pmaBtnHtml = '<button class="dfp-bottom-pma-btn' + (node.premultipliedAlpha ? ' active' : '') + '" onclick="SMTool._togglePMA(' + node.id + ',' + !node.premultipliedAlpha + ')" title="预乘 Alpha">' +
        (node.premultipliedAlpha ? '🔴 Alpha' : '⚪ Alpha') + '</button>';
    footer.innerHTML = loopBtnHtml + pmaBtnHtml;
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
                var curState = '';
                if (node) {
                    if (node.nodeType === 'entry') curState = 'entry';
                    else if (node.nodeType === 'exit') curState = 'exit';
                    else curState = node.currentAnim || '';
                }
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

// ---- PMA 切换（单选：仅更新 footer，不重建面板以保持当前页签）----
SMTool._togglePMA = function (nid, v) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    node.premultipliedAlpha = v;
    SMTool._updateEl(node);
    SMTool._updateBottomBar();
    // ★ 立即同步到浮窗预览
    var pp = SMData._animPreview;
    if (pp && pp.visible && pp.skeleton && pp.nodeId === nid) {
        SMTool._syncPreviewPmaAndSkin(pp, node);
    }
};

// 多选时批量切换 PMA（仅更新 footer）
SMTool._toggleMultiPMA = function (v) {
    SMData.selectedNodes.forEach(function (nid) {
        var n = SMData.nodes.get(nid);
        if (n) { n.premultipliedAlpha = v; SMTool._updateEl(n); }
    });
    SMTool._updateBottomBar();
};

// ---- 重复节点红色高亮检测 ----
SMTool._updateDuplicateHighlights = function () {
    // 按 sourceFile + currentAnim 分组
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

    // 为每个重复组分配不同颜色
    var dupColors = [
        '#ff4444', '#ff8c00', '#ffd700', '#44bb44', '#44aaff',
        '#8844ff', '#ff44aa', '#44dddd', '#ff8844', '#88ff44',
        '#ee3333', '#cc6600', '#eebb00', '#228833', '#3377cc',
        '#6633cc', '#cc2277', '#229999', '#dd5522', '#55aa22'
    ];
    var groupColorMap = {};  // "sourceFile|anim" → color
    var nextColor = 0;

    var groupEntriesIter = groups.entries();
    var gResult = groupEntriesIter.next();
    while (!gResult.done) {
        var key = gResult.value[0];
        var ids = gResult.value[1];
        if (ids.length > 1) {
            groupColorMap[key] = dupColors[nextColor % dupColors.length];
            nextColor++;
        }
        gResult = groupEntriesIter.next();
    }

    // 应用高亮颜色
    var nodesIter2 = SMData.nodes.values();
    var result2 = nodesIter2.next();
    while (!result2.done) {
        var el2 = SMTool._getEl(result2.value.id);
        if (el2) {
            var n2 = result2.value;
            var key2 = n2.sourceFile + '|' + n2.currentAnim;
            var dupList = groups.get(key2);
            var isDup = dupList && dupList.length > 1;
            el2.classList.toggle('duplicate-highlight', isDup);
            if (isDup && groupColorMap[key2]) {
                el2.style.setProperty('--dup-color', groupColorMap[key2]);
                el2.style.setProperty('--dup-glow', groupColorMap[key2] + '80');
            } else {
                el2.style.removeProperty('--dup-color');
                el2.style.removeProperty('--dup-glow');
            }
        }
        result2 = nodesIter2.next();
    }
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

// ---- 关闭缺失状态通知面板 ----
SMTool._closeMissingPanel = function () {
    var panel = document.getElementById('missingPanel');
    if (panel) {
        panel.classList.remove('show');
    }
    // ★ 用户主动关闭 → 本次会话不再弹出
    SMData._missingPanelDismissed = true;
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
    node._srcTexDataUrls = sourceNode._srcTexDataUrls ? sourceNode._srcTexDataUrls.slice() : [];
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

// ================================================================
// 更新底部动画组合浮窗面板
// ================================================================
SMTool._updateFlowPanel = function () {
    var content = document.getElementById('flpContent');
    var panel = document.getElementById('flowPanel');
    if (!content || !panel) return;
    var _savedScrollTop = content.scrollTop;

    if (SMData.flowMode === 'full') {
        SMTool._updateFullFlowPanel(content, panel);
        // _updateFullFlowPanel 内部已处理 .flp-full-list 的滚动位置恢复
        return;
    }

    // ---- 三层模式（原有逻辑） ----
    // 单选一个节点 或 选中同一组内多个节点时显示
    var selNodeId = SMData.selectedNode;
    var showFlow = selNodeId && (
        SMData.selectedNodes.size === 1 ||
        (SMData.selectedNodes.size > 1 && SMTool._findGroupOf(selNodeId))
    );
    if (showFlow) {
        var selNode = SMData.nodes.get(selNodeId);
        if (!selNode) {
            panel.classList.add('inactive');
            content.innerHTML = '<div class="flp-hint">点击选中一个动画节点，查看其上下游动画组合</div>';
            content.scrollTop = _savedScrollTop;
            return;
        }

        // 收集上游连接（selected node 作为 toNode，即左端点被连入）
        var upstreamConns = [];
        // 收集下游连接（selected node 作为 fromNode，即右端点连出）
        var downstreamConns = [];

        for (var i = 0; i < SMData.connections.length; i++) {
            var c = SMData.connections[i];
            if (c.toNode === selNodeId) {
                upstreamConns.push(c);
            }
            if (c.fromNode === selNodeId) {
                downstreamConns.push(c);
            }
        }

        // 没有任何连接
        if (upstreamConns.length === 0 && downstreamConns.length === 0) {
            panel.classList.remove('inactive');
            content.innerHTML = '<div class="flp-no-chain">🔗 节点 "' + SMTool._esc(selNode.name || '') + '" 暂无上下游连线<br/><span style="font-size:11px;color:var(--text2)">使用连线模式连接动画节点即可生成流程</span></div>';
            content.scrollTop = _savedScrollTop;
            return;
        }

        panel.classList.remove('inactive');

        // 辅助：将内部标识转为显示名
        var _disp = function (s) {
            if (s === 'entry') return '入口';
            if (s === 'exit') return '出口';
            return s;
        };

        // 获取节点的动画名（优先使用 currentAnim，否则用第一个动画）
        var selAnim = _disp(selNode.currentAnim) || (selNode.animations.length > 0 ? selNode.animations[0].name : selNode.name);

        // 生成流程链 HTML
        var chainsHtml = '';
        var chainIndex = 1;

        // 情况1：有上游也有下游 → 组合成完整链
        if (upstreamConns.length > 0 && downstreamConns.length > 0) {
            for (var u = 0; u < upstreamConns.length; u++) {
                var uc = upstreamConns[u];
                var upNode = SMData.nodes.get(uc.fromNode);
                if (!upNode) continue;
                var upAnimName = _disp(uc.fromState) || (upNode.currentAnim || (upNode.animations.length > 0 ? upNode.animations[0].name : upNode.name));
                var upCond = uc.condition || '';

                for (var d = 0; d < downstreamConns.length; d++) {
                    var dc = downstreamConns[d];
                    var downNode = SMData.nodes.get(dc.toNode);
                    if (!downNode) continue;
                    var downAnimName = _disp(dc.toState) || (downNode.currentAnim || (downNode.animations.length > 0 ? downNode.animations[0].name : downNode.name));
                    var downCond = dc.condition || '';

                    var nodeIds = [upNode.id, selNodeId, downNode.id].join(',');
                    var connIds = [uc.id, dc.id].join(',');
                    chainsHtml += '<div class="flp-chain-group">';
                    chainsHtml += '<div class="flp-chain-row" data-flow-nodes="' + nodeIds + '" data-flow-conns="' + connIds + '">';

                    // 上游节点（第一级）
                    chainsHtml += '<span class="flp-node-l1" title="' + SMTool._esc(upNode.name) + '">' + SMTool._esc(upAnimName) + '</span>';

                    // 箭头 + 上游条件
                    chainsHtml += '<span class="flp-arrow">→</span>';
                    if (upCond) {
                        chainsHtml += '<span class="flp-condition" title="' + SMTool._esc(upCond) + '">条件：' + SMTool._esc(upCond) + '</span>';
                    } else {
                        chainsHtml += '<span class="flp-condition-empty">条件：（空）</span>';
                    }

                    // 箭头 + 当前选中节点（第二级）
                    chainsHtml += '<span class="flp-arrow">→</span>';
                    chainsHtml += '<span class="flp-node-l2" title="' + SMTool._esc(selNode.name) + '">' + SMTool._esc(selAnim) + '</span>';

                    // 箭头 + 下游条件
                    chainsHtml += '<span class="flp-arrow">→</span>';
                    if (downCond) {
                        chainsHtml += '<span class="flp-condition" title="' + SMTool._esc(downCond) + '">条件：' + SMTool._esc(downCond) + '</span>';
                    } else {
                        chainsHtml += '<span class="flp-condition-empty">条件：（空）</span>';
                    }

                    // 箭头 + 下游节点（第三级）
                    chainsHtml += '<span class="flp-arrow">→</span>';
                    chainsHtml += '<span class="flp-node-l3" title="' + SMTool._esc(downNode.name) + '">' + SMTool._esc(downAnimName) + '</span>';

                    chainsHtml += '</div></div>';
                    chainIndex++;
                }
            }
        }
        // 情况2：只有上游
        else if (upstreamConns.length > 0) {
            for (var u2 = 0; u2 < upstreamConns.length; u2++) {
                var uc2 = upstreamConns[u2];
                var upNode2 = SMData.nodes.get(uc2.fromNode);
                if (!upNode2) continue;
                var upAnimName2 = _disp(uc2.fromState) || (upNode2.currentAnim || (upNode2.animations.length > 0 ? upNode2.animations[0].name : upNode2.name));
                var upCond2 = uc2.condition || '';

                var nodeIds2 = [upNode2.id, selNodeId].join(',');
                var connIds2 = String(uc2.id);
                chainsHtml += '<div class="flp-chain-group">';
                chainsHtml += '<div class="flp-chain-row" data-flow-nodes="' + nodeIds2 + '" data-flow-conns="' + connIds2 + '">';

                chainsHtml += '<span class="flp-node-l1" title="' + SMTool._esc(upNode2.name) + '">' + SMTool._esc(upAnimName2) + '</span>';
                chainsHtml += '<span class="flp-arrow">→</span>';
                if (upCond2) {
                    chainsHtml += '<span class="flp-condition" title="' + SMTool._esc(upCond2) + '">条件：' + SMTool._esc(upCond2) + '</span>';
                } else {
                    chainsHtml += '<span class="flp-condition-empty">条件：（空）</span>';
                }
                chainsHtml += '<span class="flp-arrow">→</span>';
                chainsHtml += '<span class="flp-node-l2" title="' + SMTool._esc(selNode.name) + '">' + SMTool._esc(selAnim) + '</span>';

                chainsHtml += '</div></div>';
                chainIndex++;
            }
        }
        // 情况3：只有下游
        else if (downstreamConns.length > 0) {
            for (var d2 = 0; d2 < downstreamConns.length; d2++) {
                var dc2 = downstreamConns[d2];
                var downNode2 = SMData.nodes.get(dc2.toNode);
                if (!downNode2) continue;
                var downAnimName2 = _disp(dc2.toState) || (downNode2.currentAnim || (downNode2.animations.length > 0 ? downNode2.animations[0].name : downNode2.name));
                var downCond2 = dc2.condition || '';

                var nodeIds3 = [selNodeId, downNode2.id].join(',');
                var connIds3 = String(dc2.id);
                chainsHtml += '<div class="flp-chain-group">';
                chainsHtml += '<div class="flp-chain-row" data-flow-nodes="' + nodeIds3 + '" data-flow-conns="' + connIds3 + '">';

                chainsHtml += '<span class="flp-node-l2" title="' + SMTool._esc(selNode.name) + '">' + SMTool._esc(selAnim) + '</span>';
                chainsHtml += '<span class="flp-arrow">→</span>';
                if (downCond2) {
                    chainsHtml += '<span class="flp-condition" title="' + SMTool._esc(downCond2) + '">条件：' + SMTool._esc(downCond2) + '</span>';
                } else {
                    chainsHtml += '<span class="flp-condition-empty">条件：（空）</span>';
                }
                chainsHtml += '<span class="flp-arrow">→</span>';
                chainsHtml += '<span class="flp-node-l3" title="' + SMTool._esc(downNode2.name) + '">' + SMTool._esc(downAnimName2) + '</span>';

                chainsHtml += '</div></div>';
                chainIndex++;
            }
        }

        content.innerHTML = chainsHtml;
        content.scrollTop = Math.min(_savedScrollTop, content.scrollHeight - content.clientHeight);

        // 如果之前有高亮的组合链，恢复其激活状态
        if (SMData._flowFocus) {
            var rows = content.querySelectorAll('.flp-chain-row');
            var focusConnIds = SMData._flowFocus.connIds;
            for (var ri = 0; ri < rows.length; ri++) {
                var r = rows[ri];
                var connsStr = r.getAttribute('data-flow-conns');
                if (!connsStr) continue;
                var connIdArr = connsStr.split(',');
                var match = connIdArr.length === focusConnIds.size;
                if (match) {
                    for (var cii = 0; cii < connIdArr.length; cii++) {
                        if (!focusConnIds.has(parseInt(connIdArr[cii]))) { match = false; break; }
                    }
                }
                if (match) {
                    r.classList.add('active');
                }
            }
        }
    } else if (SMData.selectedNodes.size > 1) {
        panel.classList.add('inactive');
        content.innerHTML = '<div class="flp-hint">已多选 ' + SMData.selectedNodes.size + ' 个节点<br/><span style="font-size:11px">单选一个节点以查看其动画组合</span></div>';
        content.scrollTop = _savedScrollTop;
    } else {
        panel.classList.add('inactive');
        content.innerHTML = '<div class="flp-hint">点击选中一个动画节点，查看其上下游动画组合</div>';
        content.scrollTop = _savedScrollTop;
    }
};

// ================================================================
// 完整动画组模式面板
// ================================================================
SMTool._updateFullFlowPanel = function (content, panel) {
    var _savedScrollTop = content.scrollTop;
    var selNodeId = SMData.selectedNode;
    var showFlow = selNodeId && (
        SMData.selectedNodes.size === 1 ||
        (SMData.selectedNodes.size > 1 && SMTool._findGroupOf(selNodeId))
    );
    if (!showFlow) {
        // ★ 无选中节点时清除旧路径，防止展开面板时误触发播放/重置
        SMData._fullPaths = [];
        panel.classList.add('inactive');
        content.innerHTML = '<div class="flp-hint">点击选中一个动画节点，查看其完整动画组合</div>';
        content.scrollTop = _savedScrollTop;
        return;
    }

    var selNode = SMData.nodes.get(selNodeId);
    if (!selNode) {
        panel.classList.add('inactive');
        content.innerHTML = '<div class="flp-hint">节点不存在</div>';
        content.scrollTop = _savedScrollTop;
        return;
    }

    // 计算所有完整路径
    var paths = SMTool._findAllFullPaths(selNodeId);
    SMData._fullPaths = paths;

    if (paths.length === 0) {
        panel.classList.remove('inactive');
        content.innerHTML = '<div class="flp-no-chain">🔗 节点 "' + SMTool._esc(selNode.name || '') + '" 暂无完整动画组<br/><span style="font-size:11px;color:var(--text2)">从该节点出发没有下游连线</span></div>';
        content.scrollTop = _savedScrollTop;
        return;
    }

    panel.classList.remove('inactive');

    // 辅助显示名
    var _disp = function (s) {
        if (s === 'entry') return '入口';
        if (s === 'exit') return '出口';
        return s;
    };

    // 当前播放状态
    var pb = SMData._fullPlayback;
    var activePathIdx = pb.activePathIdx;

    var html = '<div class="flp-full-layout">';
    // 左侧路径列表
    html += '<div class="flp-full-list">';
    for (var pi = 0; pi < paths.length; pi++) {
        var path = paths[pi];
        var isActivePath = (pi === activePathIdx);
        html += '<div class="flp-full-path' + (isActivePath ? ' active' : '') + '" data-path-idx="' + pi + '">';
        html += '<div class="flp-full-path-row">';
        for (var si = 0; si < path.nodes.length; si++) {
            var sn = path.nodes[si];
            var stateClass = 'flp-full-state';
            if (sn.cycleClose) {
                stateClass += ' cycle-close';
            } else if (isActivePath) {
                if (si < pb.currentStep) stateClass += ' played';
                else if (si === pb.currentStep) stateClass += ' current';
                else stateClass += ' upcoming';
            }
            html += '<span class="' + stateClass + '">' + SMTool._esc(_disp(sn.anim)) + '</span>';
            if (si < path.nodes.length - 1) {
                html += '<span class="flp-full-arrow">→</span>';
            }
        }
        html += '</div></div>';
    }
    html += '</div>';

    // 右侧控制区（仅保留播放控制按钮）
    html += '<div class="flp-full-player">';
    html += '<div class="flp-full-controls">';
    html += '<button class="flp-full-btn small" id="flpFullPrev" title="上一个状态">⏮</button>';
    html += '<button class="flp-full-btn" id="flpFullPlay" title="播放">▶</button>';
    html += '<button class="flp-full-btn small" id="flpFullNext" title="下一个状态">⏭</button>';
    html += '</div>';
    html += '</div>';

    html += '</div>';

    // ★ 保存路径列表的滚动位置（实际滚动容器是 .flp-full-list，而非 #flpContent）
    var oldList = content.querySelector('.flp-full-list');
    var _savedListScrollTop = oldList ? oldList.scrollTop : 0;

    content.innerHTML = html;

    // ★ 恢复路径列表的滚动位置（使用 rAF 确保布局完成后生效）
    var newList = content.querySelector('.flp-full-list');
    if (newList && _savedListScrollTop > 0) {
        // 强制读取一次 offsetHeight 触发重排，确保 scrollHeight 已更新
        var maxScroll = Math.max(0, newList.scrollHeight - newList.clientHeight);
        newList.scrollTop = Math.min(_savedListScrollTop, maxScroll);
    }

    // 绑定事件
    var pathRows = content.querySelectorAll('.flp-full-path');
    for (var ri = 0; ri < pathRows.length; ri++) {
        (function (idx) {
            pathRows[ri].addEventListener('click', function (e) {
                e.stopPropagation();
                SMTool._selectFullPath(idx);
            });
        })(ri);
    }

    var playBtn = document.getElementById('flpFullPlay');
    var prevBtn = document.getElementById('flpFullPrev');
    var nextBtn = document.getElementById('flpFullNext');

    // 更新播放按钮状态
    var pb = SMData._fullPlayback;
    if (playBtn) {
        if (pb.isPlaying) {
            playBtn.innerHTML = '⏸';
            playBtn.title = '暂停';
        } else if (pb.activePathIdx >= 0) {
            var ppath = SMData._fullPaths[pb.activePathIdx];
            var pmax = ppath ? ppath.nodes.length : 0;
            if (ppath && ppath.nodes[pmax - 1] && ppath.nodes[pmax - 1].cycleClose) pmax--;
            if (pb.currentStep >= pmax) {
                // ★ 已播放完毕 → 显示重新播放
                playBtn.innerHTML = '🔄';
                playBtn.title = '重新播放';
            } else if (pb.currentStep === pmax - 1) {
                // ★ 已在最后一步 → 播放最后一节
                playBtn.innerHTML = '▶';
                playBtn.title = '播放最后一节';
            } else if (pb.currentStep > 0) {
                playBtn.innerHTML = '▶';
                playBtn.title = '继续播放';
            } else {
                playBtn.innerHTML = '▶';
                playBtn.title = '播放';
            }
        } else {
            playBtn.innerHTML = '▶';
            playBtn.title = '播放';
        }
        playBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (SMData._fullPlayback.isPlaying) {
                SMTool._pauseFullPlayback();
                // ★ 暂停后更新按钮状态
                var pp2 = SMData._fullPaths[SMData._fullPlayback.activePathIdx];
                var pm2 = pp2 ? pp2.nodes.length : 0;
                if (pp2 && pp2.nodes[pm2 - 1] && pp2.nodes[pm2 - 1].cycleClose) pm2--;
                var cs2 = SMData._fullPlayback.currentStep;
                if (cs2 >= pm2) {
                    playBtn.innerHTML = '🔄';
                    playBtn.title = '重新播放';
                } else if (cs2 === pm2 - 1) {
                    playBtn.innerHTML = '▶';
                    playBtn.title = '播放最后一节';
                } else if (cs2 > 0) {
                    playBtn.innerHTML = '▶';
                    playBtn.title = '继续播放';
                } else {
                    playBtn.innerHTML = '▶';
                    playBtn.title = '播放';
                }
            } else {
                SMData._animPreview._suppressShow = true;
                SMTool._startFullPlayback();
                SMData._animPreview._suppressShow = false;
                playBtn.innerHTML = '⏸';
                playBtn.title = '暂停';
                // ================================================================
                // 🔒🔒🔒 [LOCK-F] 播放按钮启动预览的方式
                // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
                //    如需修改，一定要寻求同意"解锁"才可以。
                //
                // 必须通过 _showAnimPreview 更新预览（内部处理同源/异源切换），
                // 禁止在此处手动 _destroyAnimPreview + _initAnimPreview 组合。
                // 禁止在此处做 visibility/display 隐藏再显示的 hack。
                // _suppressShow 旗标已在上方封锁 _startFullPlayback 期间的中间态调用。
                // ================================================================
                var pb2 = SMData._fullPlayback;
                var path2 = SMData._fullPaths[pb2.activePathIdx];
                if (path2 && pb2.currentStep < path2.nodes.length) {
                    var stepNode = path2.nodes[pb2.currentStep];
                    if (stepNode && !stepNode.cycleClose) {
                        var stepSpineNode = SMData.nodes.get(stepNode.id);
                        if (stepSpineNode) SMTool._showAnimPreview(stepSpineNode);
                    }
                }
                // 🔒 [LOCK-F] END
            }
        });
    }
    if (prevBtn) {
        prevBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            SMTool._goToPrevStep();
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            SMTool._goToNextStep();
        });
    }

    // 初始化右侧 Spine 画布（已移除，改为使用浮窗预览）

    // 🔒 [LOCK-4] 锚钉激活+锁未锁定时，自动进入流预览
    if (pb.activePathIdx < 0 && paths.length > 0 && !pb.isPlaying && SMData._flowPanel.pinned && !SMData._flowExitLock) {
        SMTool._selectFullPath(0);
    }
};

// 设置焦点高亮
// 播放中：仅当前节点+前后连线
// 已选中路径：仅该路径上的节点+连线
// 未选中路径：BFS全组件
SMTool._setFullComponentFocus = function (sourceId) {
    var pb = SMData._fullPlayback;
    if (pb.activePathIdx >= 0) {
        var selPath = SMData._fullPaths[pb.activePathIdx];
        if (pb.isPlaying && selPath && pb.currentStep < selPath.nodes.length) {
            // 播放中：仅当前节点 + 前后连线
            var curId1 = selPath.nodes[pb.currentStep].id;
            var cn1 = new Set(); cn1.add(curId1);
            var cc1 = new Set();
            if (pb.currentStep > 0 && pb.currentStep - 1 < selPath.conns.length) cc1.add(selPath.conns[pb.currentStep - 1]);
            if (pb.currentStep < selPath.conns.length) cc1.add(selPath.conns[pb.currentStep]);
            SMData._flowFocus = { nodeIds: cn1, connIds: cc1 };
            return;
        }
        if (pb._stepped && selPath && pb.currentStep < selPath.nodes.length) {
            // 手动上一个/下一个导航：仅当前节点 + 前后连线
            var curId2 = selPath.nodes[pb.currentStep].id;
            var cn2 = new Set(); cn2.add(curId2);
            var cc2 = new Set();
            if (pb.currentStep > 0 && pb.currentStep - 1 < selPath.conns.length) cc2.add(selPath.conns[pb.currentStep - 1]);
            if (pb.currentStep < selPath.conns.length) cc2.add(selPath.conns[pb.currentStep]);
            SMData._flowFocus = { nodeIds: cn2, connIds: cc2 };
            return;
        }
        if (selPath) {
            // 仅选中路径（未播放/未导航）：路径上所有节点 + 两端都在路径内的所有连线高亮
            var pNodeIds = new Set();
            var pConnIds = new Set();
            for (var ni = 0; ni < selPath.nodes.length; ni++) pNodeIds.add(selPath.nodes[ni].id);
            for (var ci2 = 0; ci2 < SMData.connections.length; ci2++) {
                var cc = SMData.connections[ci2];
                if (pNodeIds.has(cc.fromNode) && pNodeIds.has(cc.toNode)) pConnIds.add(cc.id);
            }
            SMData._flowFocus = { nodeIds: pNodeIds, connIds: pConnIds };
            return;
        }
    }

    // 无选中路径：BFS 全组件焦点
    var nodeIds = new Set();
    var connIds = new Set();
    var queue = [sourceId];
    nodeIds.add(sourceId);
    while (queue.length > 0) {
        var cur = queue.shift();
        for (var i = 0; i < SMData.connections.length; i++) {
            var c = SMData.connections[i];
            if (c.fromNode === cur && !nodeIds.has(c.toNode)) {
                nodeIds.add(c.toNode);
                connIds.add(c.id);
                queue.push(c.toNode);
            }
            if (c.toNode === cur && !nodeIds.has(c.fromNode)) {
                nodeIds.add(c.fromNode);
                connIds.add(c.id);
                queue.push(c.fromNode);
            }
        }
    }
    // 补上所有两端都在 nodeIds 内的间接连线
    for (var j = 0; j < SMData.connections.length; j++) {
        var cj = SMData.connections[j];
        if (nodeIds.has(cj.fromNode) && nodeIds.has(cj.toNode)) {
            connIds.add(cj.id);
        }
    }
    SMData._flowFocus = { nodeIds: nodeIds, connIds: connIds };
};

// 初始化右侧 Spine 画布 — 完整渲染版
// ★ 关键修复：右侧画布必须使用独立的 atlas/skeletonData，绝不能修改共享的 selNode.atlasData。
//    否则共享图集的 page.texture 会被替换为右侧画布的 WebGL 纹理，导致主视口渲染错乱（显示图集/绑定姿势）。
// ★ 右侧画布播放器已移除（改为使用浮窗动画预览）
// _initFullCanvas, _disposeFullCanvasResources, _updateFullCanvasForStep, _drawFullCanvasFallback 已删除

// ================================================================
// 🔒🔒🔒 [LOCK-5] 选择完整路径 — 仅高亮，不打断画布动画
// ⚠️ 解锁策略：仅用户明确说「解锁 LOCK-5」才能改！
// 调用方：_expandFlowPanel（自动选第一个路径）、面板内点击路径
// 规则：只设置 activePathIdx 和更新 UI，不调 _resetAllToAnimFrame1
//       动画暂停仅发生在 _startFullPlayback / _goToPrevStep / _goToNextStep
// ================================================================
SMTool._selectFullPath = function (pathIdx) {
    SMData._fullPlayback.activePathIdx = pathIdx;
    SMData._fullPlayback.currentStep = 0;
    SMData._fullPlayback.isPlaying = false;
    SMData._fullPlayback._stepped = false;
    if (SMData._fullPlayback._timer) { clearTimeout(SMData._fullPlayback._timer); SMData._fullPlayback._timer = null; }
    SMTool._clearAllProgressBars();
    // ★ [LOCK-5] 仅高亮选中路径，不打断画布动画（播放/上一步/下一步才暂停）
    SMTool._setFullComponentFocus(SMData.selectedNode);
    SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
    SMTool._updateSel();
    SMTool._updateStateRowColors();

    // ★ 触发右上角动画预览浮窗
    var selNode = SMData.nodes.get(SMData.selectedNode);
    if (selNode) SMTool._showAnimPreview(selNode);
};

// 开始/继续播放（已播完则从头开始；播放到最后一个动画后自动停止）
SMTool._startFullPlayback = function () {
    var pb = SMData._fullPlayback;
    if (pb.activePathIdx < 0) return;
    var path = SMData._fullPaths[pb.activePathIdx];
    if (!path || path.nodes.length === 0) return;
    // 如果已播完，从头开始
    var maxStep = path.nodes.length;
    if (path.nodes[maxStep - 1] && path.nodes[maxStep - 1].cycleClose) maxStep--;
    if (pb.currentStep >= maxStep) pb.currentStep = 0;

    // ★ 全新开始时重置所有节点到各自动画第一帧（暂停后恢复则跳过）
    //    单节点流跳过全量重置，由 _applyStepToMainNode 单独处理避免冻结残留
    if (pb.currentStep === 0 && maxStep > 1) {
        SMTool._resetAllToAnimFrame1();
    } else if (pb.currentStep > 0) {
        // ★ 从中间步骤恢复播放：强制刷新当前步骤节点动画
        var curStepNode = path.nodes[pb.currentStep];
        if (curStepNode && !curStepNode.cycleClose) {
            SMTool._applyStepToMainNode(curStepNode);
        }
    }

    pb._stepped = false;
    pb.isPlaying = true;
    SMTool._playFullStep();
};

// 暂停播放
SMTool._pauseFullPlayback = function () {
    SMData._fullPlayback.isPlaying = false;
    if (SMData._fullPlayback._timer) { clearTimeout(SMData._fullPlayback._timer); SMData._fullPlayback._timer = null; }
    // 冻结当前进度条（不清除，保持可见）
    var bars = document.querySelectorAll('.spine-node .anim-progress-bar.playing');
    for (var i = 0; i < bars.length; i++) {
        bars[i].classList.add('paused');
    }
    // ★ 暂停时冻结所有节点（不恢复各自的动画）
    SMTool._freezeAllNodes();
};

// ★ 冻结所有 Spine 动画节点（播放完毕或暂停时调用，不清除 _pausedByFlow 标记以便后续 prev/next 操作）
SMTool._freezeAllNodes = function () {
    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        var n = r.value;
        if (n.state && n.skeletonData) {
            // ★ 冻结前先 apply 一次确保当前帧被正确渲染
            try {
                n.state.apply(n.skeleton);
                n.skeleton.updateWorldTransform(n._physParam);
            } catch (e) {}
            // 尝试通过 timeScale=0 冻结所有轨道的动画，保留当前帧
            try {
                for (var ti = 0; ti < 5; ti++) {
                    var entry = n.state.getCurrent(ti);
                    if (entry) { entry.timeScale = 0; }
                }
            } catch (e) {
                // 回退：清除轨道
                try { n.state.clearTracks(); } catch (e2) {}
            }
            n._pausedByFlow = true;
        }
        r = nodesIter.next();
    }
    // ★ 同步冻结预览浮窗（暂停/播放完毕时停在当前帧）
    if (SMData._animPreview && SMData._animPreview.visible) {
        SMData._animPreview._flowFrozen = true;
    }
};

// ================================================================
// 🔒🔒🔒 [LOCK-3] 动画流播放节点状态管理
// ⚠️ 解锁策略：除非用户明确说「解锁 LOCK-3」，或我主动问询
//    「是否解锁 LOCK-3 以修改XX功能」且用户同意，否则绝不改动此块。
//
// 核心规则（用户最终确定）：
//   未轮到 → 该节点自身动画第一帧（冻结）
//   正在播 → 不循环播放 loop=false
//   已播完 → 该节点自身动画最后一帧
//   切换不同文件流 → 先清理所有节点，再初始化新流
// 联动函数（修改任一个前必须理解全部）：
//   _resetAllToAnimFrame1 / _pauseAllNodesExcept /
//   _applyStepToMainNode / _selectFullPath / _startFullPlayback / _freezeAllNodes
// ================================================================

// ★ 所有节点重置到各自动画的第一帧并冻结（动画流开始时的初始状态）
SMTool._resetAllToAnimFrame1 = function () {
    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        var n = r.value;
        if (n.skeleton && n.state && n.skeletonData) {
            // ★ 保存原始轨道配置，以便后续取消暂停时恢复
            if (!n._pausedByFlow) {
                n._savedTracks = n.tracks ? JSON.parse(JSON.stringify(n.tracks)) : null;
                n._savedLoop = n.loop;
                n._pausedByFlow = true;
            }
            try { n.state.clearTracks(); } catch (e) {}
            try { n.skeleton.setToSetupPose(); } catch (e) {}
            // 应用节点自身的动画第一帧
            var animName = n.currentAnim || (n.animations.length > 0 ? n.animations[0].name : '');
            if (animName) {
                try {
                    n.state.setAnimation(0, animName, false);
                    n.state.update(0);
                    n.state.apply(n.skeleton);
                    n.skeleton.updateWorldTransform(n._physParam);
                    // 冻结在第一帧（timeScale=0 确保后续不会被 _loop 推进）
                    var entry = n.state.getCurrent(0);
                    if (entry) entry.timeScale = 0;
                } catch (e) {}
            }
        }
        r = nodesIter.next();
    }
};

// ================================================================
// ★ 取消暂停所有节点（轻量，不重置帧位置，画面无卡顿）
// ================================================================
SMTool._unfreezeAllNodes = function () {
    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        var n = r.value;
        if (!n.state) { r = nodesIter.next(); continue; }
        // 恢复保存的轨道配置
        if (n._pausedByFlow && n._savedTracks && n._savedTracks.length > 0) {
            n.tracks = JSON.parse(JSON.stringify(n._savedTracks));
            n.loop = n._savedLoop !== undefined ? n._savedLoop : (n.tracks[0] && n.tracks[0].loop !== false);
            n.currentAnim = n.tracks[0].animName || '';
        }
        // ★ 扫描所有轨道，修复任何 timeScale===0 的残留冻结（不限 _pausedByFlow 标记）
        try {
            var anyFrozen = false;
            for (var ti = 0; ti < 5; ti++) {
                var entry = n.state.getCurrent(ti);
                if (entry && entry.timeScale === 0) {
                    entry.timeScale = 1.0;
                    anyFrozen = true;
                }
            }
            // 如果有冻结轨道但 _pausedByFlow 为 false（状态标记丢失），回退暴力恢复
            if (anyFrozen && !n._pausedByFlow) {
                try { n.state.clearTracks(); SMTool._applyTracksToState(n); } catch (e2) {}
            }
        } catch (e) {
            try { n.state.clearTracks(); SMTool._applyTracksToState(n); } catch (e2) {}
        }
        n._pausedByFlow = false;
        n._savedTracks = undefined;
        n._savedLoop = undefined;
        r = nodesIter.next();
    }
};

// ================================================================
// 🔒🔒🔒 [LOCK-4] 强制重置所有节点到正常播放（退出动画流时调用）
// ⚠️ 解锁策略：除非用户明确说「解锁 LOCK-4」，否则绝不改动。
// 暴力恢复：清轨道→setToSetupPose→_savedTracks恢复→applyTracks→update(0)
// 无视任何残留的 timeScale=0 / clearTracks / _pausedByFlow 状态
// ================================================================
SMTool._forceResetAllNodes = function () {
    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        var n = r.value;
        if (n.state && n.skeletonData && n.skeleton) {
            try { n.state.clearTracks(); } catch (e) {}
            try { n.skeleton.setToSetupPose(); } catch (e) {}
            // 恢复默认轨道配置
            if (!n.tracks || n.tracks.length === 0) {
                SMTool._initDefaultTracks(n);
            }
            n.tracks[0].loop = (n.loop !== false);
            if (n._savedTracks && n._savedTracks.length > 0) {
                n.tracks = JSON.parse(JSON.stringify(n._savedTracks));
                n.loop = n._savedLoop !== undefined ? n._savedLoop : (n.tracks[0] && n.tracks[0].loop !== false);
                n.currentAnim = n.tracks[0].animName || '';
            }
            try {
                SMTool._applyTracksToState(n);
                n.state.update(0);
                n.state.apply(n.skeleton);
                n.skeleton.updateWorldTransform(n._physParam);
            } catch (e) {}
            n._pausedByFlow = false;
            n._savedTracks = undefined;
            n._savedLoop = undefined;
        }
        r = nodesIter.next();
    }
};

// 暂停除指定节点外的所有 Spine 动画节点（保存完整 tracks 配置以便恢复）
SMTool._pauseAllNodesExcept = function (exceptId) {
    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        var n = r.value;
        if (n.id !== exceptId && n.state && n.skeletonData) {
            if (!n._pausedByFlow) {
                n._savedTracks = n.tracks ? JSON.parse(JSON.stringify(n.tracks)) : null;
                n._savedLoop = n.loop;
                n._pausedByFlow = true;
            }
            // ================================================================
            // 🔒🔒🔒 [LOCK-G] 用 timeScale=0 冻结节点，严禁 clearTracks
            // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
            //    如需修改，一定要寻求同意"解锁"才可以。
            //
            // clearTracks 后渲染循环调用 state.apply 会重置骨架到 setup pose，
            // 导致主画布上非当前步骤的节点全部跳回 T-pose，产生严重闪烁。
            // timeScale=0 只冻结动画进度，保留当前帧画面不变。
            // ================================================================
            try {
                for (var ti = 0; ti < 5; ti++) {
                    var entry = n.state.getCurrent(ti);
                    if (entry) entry.timeScale = 0;
                }
            } catch (e) {}
            // 🔒 [LOCK-G] END
        }
        r = nodesIter.next();
    }
};

// 恢复所有被动画组播放暂停的 Spine 动画节点
SMTool._resumeAllNodes = function () {
    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        var n = r.value;
        if (n._pausedByFlow && n.state && n.skeletonData) {
            // ★ 恢复完整 tracks 配置（支持多轨道）
            if (n._savedTracks && n._savedTracks.length > 0) {
                n.tracks = JSON.parse(JSON.stringify(n._savedTracks));
                n.loop = n._savedLoop !== undefined ? n._savedLoop : (n.tracks[0] && n.tracks[0].loop !== false);
                n.currentAnim = n.tracks[0].animName || '';
            } else {
                // 回退：至少恢复 track 0
                var restoreAnim = n.currentAnim || (n.animations.length > 0 ? n.animations[0].name : '');
                var restoreLoop = n._savedLoop !== undefined ? n._savedLoop : n.loop;
                if (restoreAnim) {
                    if (!n.tracks || n.tracks.length === 0) {
                        SMTool._initDefaultTracks(n);
                    }
                    n.tracks[0].animName = restoreAnim;
                    n.tracks[0].loop = restoreLoop !== false;
                    n.loop = restoreLoop !== false;
                    n.currentAnim = restoreAnim;
                }
            }
            try {
                n.skeleton.setToSetupPose();
                n.state.clearTracks();
                SMTool._applyTracksToState(n);
            } catch (e) { /* 忽略 */ }
            n._pausedByFlow = false;
            n._savedTracks = undefined;
            n._savedAnim = undefined;
            n._savedLoop = undefined;
        }
        r = nodesIter.next();
    }
};

// ★ 将当前步骤的动画应用到主画布节点（供 _playFullStep / _goToPrevStep / _goToNextStep 复用）
SMTool._applyStepToMainNode = function (stepNode) {
    SMTool._pauseAllNodesExcept(stepNode.id);

    var spineNode = SMData.nodes.get(stepNode.id);
    // ★ 延时器节点：无骨架，直接返回节点引用
    if (spineNode && spineNode.nodeType === 'delayer') {
        return spineNode;
    }
    if (spineNode && spineNode.state && spineNode.skeleton) {
        // ★ 彻底清除旧状态：清轨道 + 解冻 + 重置骨架
        try { spineNode.state.clearTracks(); } catch (e) {}
        try { spineNode.skeleton.setToSetupPose(); } catch (e) {}
        if (!spineNode._pausedByFlow) {
            // ★ 保存完整 tracks 配置（支持多轨道恢复）
            spineNode._savedTracks = spineNode.tracks ? JSON.parse(JSON.stringify(spineNode.tracks)) : null;
            spineNode._savedLoop = spineNode.loop;
            spineNode._pausedByFlow = true;
        }
        var animName = stepNode.anim;
        if (spineNode.skeletonData) {
            var found = false;
            for (var ai = 0; ai < spineNode.skeletonData.animations.length; ai++) {
                if (spineNode.skeletonData.animations[ai].name === animName) {
                    found = true;
                    break;
                }
            }
            if (found) {
                if (!spineNode.tracks || spineNode.tracks.length === 0) {
                    SMTool._initDefaultTracks(spineNode);
                }
                spineNode.tracks[0].animName = animName;
                spineNode.currentAnim = animName;
                // ★ 应用轨道配置到状态
                SMTool._applyTracksToState(spineNode);
                // ★ 动画组播放：强制不循环，停留在最后一帧
                for (var ti = 0; ti < 5; ti++) {
                    var e = spineNode.state.getCurrent(ti);
                    if (e) e.loop = false;
                }
                // ★ 立即应用第一帧，消除 setup pose 闪烁
                spineNode.state.update(0);
                spineNode.state.apply(spineNode.skeleton);
                spineNode.skeleton.updateWorldTransform(spineNode._physParam);
            }
        }
    }
    return spineNode;
};

// 上一个状态（暂停/停止时可用，到边界停止不循环）
SMTool._goToPrevStep = function () {
    var pb = SMData._fullPlayback;
    if (pb.isPlaying) return;
    if (pb.activePathIdx < 0) return;
    var path = SMData._fullPaths[pb.activePathIdx];
    if (!path) return;
    var maxStep = path.nodes.length;
    if (path.nodes[maxStep - 1] && path.nodes[maxStep - 1].cycleClose) maxStep--;
    if (pb.currentStep > 0) {
        do { pb.currentStep--; } while (pb.currentStep > 0 && path.nodes[pb.currentStep] && path.nodes[pb.currentStep].cycleClose);
    } else {
        // ★ 已在第一步 → 循环到末尾
        pb.currentStep = maxStep - 1;
    }
    pb._stepped = true;
    // ★ 切换步骤时立即清除进度条
    SMTool._clearAllProgressBars();

    // ★ 切换主画布动画：暂停其他节点，仅播放当前步骤的动画节点
    var stepNode = path.nodes[pb.currentStep];
    if (stepNode && !stepNode.cycleClose) {
        SMTool._applyStepToMainNode(stepNode);
    }

    SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
    SMTool._setFullComponentFocus(SMData.selectedNode);
    SMTool._updateSel();
    SMTool._updateStateRowColors();

    // ★ 触发右上角动画预览浮窗（使用当前步骤节点）
    if (stepNode && !stepNode.cycleClose) {
        var prevSpineNode = SMData.nodes.get(stepNode.id);
        if (prevSpineNode && prevSpineNode.nodeType === 'spine') {
            SMTool._showAnimPreview(prevSpineNode);
        }
    }
};

// 下一个状态（暂停/停止时可用，到边界停止不循环）
SMTool._goToNextStep = function () {
    var pb = SMData._fullPlayback;
    if (pb.isPlaying) return;
    if (pb.activePathIdx < 0) return;
    var path = SMData._fullPaths[pb.activePathIdx];
    if (!path) return;
    var maxStep = path.nodes.length;
    if (path.nodes[maxStep - 1] && path.nodes[maxStep - 1].cycleClose) maxStep--;
    if (pb.currentStep < maxStep - 1) {
        pb.currentStep++;
    } else {
        // ★ 已在最后一步 → 循环到开头
        pb.currentStep = 0;
    }
    pb._stepped = true;
    // ★ 切换步骤时立即清除进度条
    SMTool._clearAllProgressBars();

    // ★ 切换主画布动画：暂停其他节点，仅播放当前步骤的动画节点
    var stepNode = path.nodes[pb.currentStep];
    if (stepNode && !stepNode.cycleClose) {
        SMTool._applyStepToMainNode(stepNode);
    }

    SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
    SMTool._setFullComponentFocus(SMData.selectedNode);
    SMTool._updateSel();
    SMTool._updateStateRowColors();

    // ★ 触发右上角动画预览浮窗（使用当前步骤节点）
    if (stepNode && !stepNode.cycleClose) {
        var nextSpineNode = SMData.nodes.get(stepNode.id);
        if (nextSpineNode && nextSpineNode.nodeType === 'spine') {
            SMTool._showAnimPreview(nextSpineNode);
        }
    }
};

// 播放当前步骤
SMTool._playFullStep = function () {
    var pb = SMData._fullPlayback;
    if (!pb.isPlaying) return;
    // ★ 解除预览浮窗冻结（播放时恢复正常更新）
    if (SMData._animPreview) {
        SMData._animPreview._flowFrozen = false;
    }
    var path = SMData._fullPaths[pb.activePathIdx];
    if (!path || pb.currentStep >= path.nodes.length) {
        pb.isPlaying = false;
        pb._stepped = false;
        SMTool._clearAllProgressBars();
        // ★ 播放完毕：冻结所有节点，不恢复各自的动画
        SMTool._freezeAllNodes();
        SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
        SMTool._setFullComponentFocus(SMData.selectedNode);
        SMTool._updateSel();
        SMTool._updateStateRowColors();
        return;
    }

    var stepNode = path.nodes[pb.currentStep];

    // 跳过闭环节点（虚线框），直接结束播放
    if (stepNode.cycleClose) {
        pb.isPlaying = false;
        pb._stepped = false;
        SMTool._clearAllProgressBars();
        // ★ 播放完毕：冻结所有节点
        SMTool._freezeAllNodes();
        SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
        SMTool._setFullComponentFocus(SMData.selectedNode);
        SMTool._updateSel();
        SMTool._updateStateRowColors();
        return;
    }

    // 暂停其他所有动画节点，仅播放当前步骤的节点
    var spineNode = SMTool._applyStepToMainNode(stepNode);

    // 更新面板高亮和画布焦点
    SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
    SMTool._setFullComponentFocus(SMData.selectedNode);
    SMTool._updateSel();
    SMTool._updateStateRowColors();
    // 不再调用 _updateEl — 避免每步切换时重建节点 DOM 导致卡顿

    // 获取动画时长来自动推进
    var duration = 1000; // 默认1秒
    if (spineNode && spineNode.nodeType === 'delayer') {
        duration = (spineNode._delayValue || 1.0) * 1000;
        var delayerBar = document.getElementById('delayerBar-' + stepNode.id);
        if (delayerBar) {
            delayerBar.style.transition = 'none';
            delayerBar.style.width = '0%';
            void delayerBar.offsetWidth;
            delayerBar.style.transition = 'width ' + duration + 'ms linear';
            delayerBar.style.width = '100%';
        }
    } else if (spineNode && spineNode.skeletonData) {
        for (var di = 0; di < spineNode.skeletonData.animations.length; di++) {
            if (spineNode.skeletonData.animations[di].name === stepNode.anim) {
                duration = spineNode.skeletonData.animations[di].duration * 1000;
                break;
            }
        }
    }

    // 启动当前节点的进度条动画
    SMTool._clearAllProgressBars();
    var progressBar = document.querySelector('#sn-' + stepNode.id + ' .anim-progress-bar');
    if (progressBar) {
        progressBar.style.setProperty('--progress-duration', duration + 'ms');
        // 强制重排后重新触发动画
        void progressBar.offsetWidth;
        progressBar.classList.add('playing');
    }

    // ★ 单节点流加 100ms 余量，确保动画完整播完最后一帧
    var timerDelay = duration + (path.nodes.length <= 1 ? 100 : 0);

    pb._timer = setTimeout(function () {
        pb.currentStep++;
        if (pb.currentStep < path.nodes.length) {
            // ★ 更新预览到下一步（第一步由按钮 _initAnimPreview 处理）
            var nextStepNode = path.nodes[pb.currentStep];
            if (nextStepNode && !nextStepNode.cycleClose) {
                var nextSpineNode = SMData.nodes.get(nextStepNode.id);
                if (nextSpineNode) SMTool._showAnimPreview(nextSpineNode);
            }
            SMTool._playFullStep();
        } else {
            // ★ 播放完毕：先将当前步骤动画推进到最后一帧，再冻结
            if (spineNode && spineNode.state && spineNode.skeleton) {
                try {
                    var lastEntry = spineNode.state.getCurrent(0);
                    if (lastEntry) {
                        var lastDur = (lastEntry.animation && lastEntry.animation.duration) ||
                                       (lastEntry._animation && lastEntry._animation.duration) || 0;
                        lastEntry.trackTime = lastDur;
                    }
                    spineNode.state.apply(spineNode.skeleton);
                    spineNode.skeleton.updateWorldTransform(spineNode._physParam);
                } catch (e) {}
            }
            pb.isPlaying = false;
            pb._stepped = false;
            SMTool._clearAllProgressBars();
            SMTool._freezeAllNodes();
            SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
            SMTool._setFullComponentFocus(SMData.selectedNode);
            SMTool._updateSel();
            SMTool._updateStateRowColors();
        }
    }, timerDelay);
};

// 清除所有节点的进度条动画
SMTool._clearAllProgressBars = function () {
    var bars = document.querySelectorAll('.spine-node .anim-progress-bar.playing, .spine-node .anim-progress-bar.paused');
    for (var i = 0; i < bars.length; i++) {
        bars[i].classList.remove('playing', 'paused');
    }
};

// 更新完整动画组的高亮（画布同步）
SMTool._updateFullHighlight = function () {
    SMTool._setFullComponentFocus(SMData.selectedNode);
    SMTool._updateSel();
    SMTool._updateStateRowColors();
};

// ★ 同步动画流路径中的状态名（节点动画变更时调用）
SMTool._syncFlowPathAnim = function (nid, newAnim) {
    // 更新所有指向此节点的连线的 toState
    var conns = SMData.connections;
    if (conns) {
        for (var ci = 0; ci < conns.length; ci++) {
            if (conns[ci].toNode === nid) {
                conns[ci].toState = newAnim;
            }
        }
    }
    // 强制刷新流面板（_findAllFullPaths 会重新计算路径，使用最新的 toState）
    SMTool._updateFullFlowPanel(document.getElementById('flpContent'), document.getElementById('flowPanel'));
};
