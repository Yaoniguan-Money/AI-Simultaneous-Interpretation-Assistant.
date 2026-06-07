; build/installer.nsh
; 自定义 NSIS 安装脚本 —— 确保中文快捷方式名称在 Unicode 模式下正确写入
; 该文件由 electron-builder.yml 的 nsis.include 引入

; 安装后自定义处理：在 ${SHORTCUT_NAME} 变量可用时强制使用 UTF-8 值
!macro customInstall
  ; 占位——当前无额外自定义安装逻辑
  ; 如需在安装后执行特殊操作（如注册文件关联），在此处添加
!macroend

; 卸载前自定义处理
!macro customUnInstall
  ; 占位——当前无额外自定义卸载逻辑
!macroend
