function show(enabled, useSettingsInsteadOfPreferences) {
    if (useSettingsInsteadOfPreferences) {
        document.getElementsByClassName('state-on')[0].innerText = "Safari 扩展已启用。现在可以关闭此窗口并开始翻译。";
        document.getElementsByClassName('state-off')[0].innerText = "Safari 扩展尚未启用，请前往 Safari 设置开启。";
        document.getElementsByClassName('state-unknown')[0].innerText = "在 Safari 设置的“扩展”中启用自带 Token 沉浸翻译。";
        document.getElementsByClassName('open-preferences')[0].innerText = "打开 Safari 扩展设置";
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
