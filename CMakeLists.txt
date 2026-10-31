cmake_minimum_required(VERSION 3.25)
# Version: single source of truth is version.json (also read by ui/vite.config.ts)
file(READ "${CMAKE_SOURCE_DIR}/version.json" _rc_version_json)
string(JSON RC_VERSION GET "${_rc_version_json}" version)
string(JSON RC_VERSION_LABEL GET "${_rc_version_json}" label)
project(RocksCellsBrowser VERSION ${RC_VERSION} LANGUAGES CXX RC)
# 公開版（rebuild-public.ps1）：exe の版の 4 つめ（無ければ 0）
set(RC_VERSION_TWEAK "${PROJECT_VERSION_TWEAK}")
if(RC_VERSION_TWEAK STREQUAL "")
  set(RC_VERSION_TWEAK 0)
endif()
# 公開版（rebuild-public.ps1）：VC++ ランタイムを exe に組み込む（/MT。vc_redist が要らない）
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# WebView2 SDK（Microsoft 公式の NuGet パッケージ）をダウンロードして展開する
set(WEBVIEW2_VERSION 1.0.4258.31)
FetchContent_Declare(webview2
  URL https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${WEBVIEW2_VERSION}
  DOWNLOAD_NAME webview2.zip
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
# JSON を読み書きするライブラリ（UI とのやりとりに使う）
FetchContent_Declare(json
  URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(webview2 json)
set(WEBVIEW2_DIR ${webview2_SOURCE_DIR}/build/native)

add_executable(RocksCellsBrowser WIN32
  src/main.cpp
  src/browser.cpp
  src/browser.h
  src/bots.cpp
  src/bots.h
  src/clipboard.cpp
  src/clipboard.h
  src/screengrab.cpp
  src/screengrab.h
  src/record.cpp
  src/record.h
  src/ocr.cpp
  src/ocr.h
  src/ocrjoin.h
  src/tabs.cpp
  src/hexmemo.cpp
  src/hexmemo.h
  src/hook.cpp
  src/hook.h
  src/l10n.cpp
  src/l10n.h
  src/livecaptions.cpp
  src/livecaptions.h
  src/media.cpp
  src/media.h
  src/storage.cpp
  src/storage.h
  src/strings.h
  src/theme.cpp
  src/theme.h
  src/apps.cpp
  src/apps.h
)
target_include_directories(RocksCellsBrowser PRIVATE ${WEBVIEW2_DIR}/include)
# 静的版のローダーを使うと、exe 1つで動く（WebView2Loader.dll を横に置かなくてよい）
# crypt32: 画像を Base64 に変換するのに使う
# advapi32: レジストリを読む（grokbot:// が登録されているか。MSVC では既定でも入るが、はっきり書いておく）
# bcrypt: ボットの返事の受け取り口で、ファイルの名前を SHA-256 から作る
# windowscodecs: 六角スクショを画像としてクリップボードに入れる（WIC で PNG を読み、CF_DIBV5 と PNG にする。S3.12）
# shell32, ole32, uuid: アプリのセル。A1 のファイルを選ぶ窓・ショートカット（IShellLink）・アイコン（SHGetFileInfo）。
#   A2 の起動（ShellExecuteEx）も shell32。窓を探す QueryFullProcessImageName は kernel32（既定でリンクされる）
#   A3 の SetWindowPos・ClientToScreen は user32（WIN32 の実行ファイルでは既定でリンクされる）
#   A5 のアプリ ID は、今リンクしているライブラリで足りる。ショートカットと窓の System.AppUserModel.ID は
#   shell32 の IPropertyStore（SHGetPropertyStoreForWindow）と ole32 の PropVariantClear。
#   プロセスの GetApplicationUserModelId は kernel32（GetProcAddress。SDK の宣言に依存しない）。
#   隠れた UWP の窓を除く DwmGetWindowAttribute は dwmapi.dll を LoadLibrary する（リンクは増やさない）
# winhttp: webhook「そのまま送る」（依頼の小窓 v2・R11）。中継の受け口へ依頼の JSON を HTTPS で POST する（hook.cpp）
target_link_libraries(RocksCellsBrowser PRIVATE
  ${WEBVIEW2_DIR}/x64/WebView2LoaderStatic.lib
  nlohmann_json::nlohmann_json
  crypt32
  advapi32
  bcrypt
  windowscodecs
  shell32
  ole32
  uuid
  winhttp
)
target_compile_definitions(RocksCellsBrowser PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
# /utf-8: ソース中の日本語を正しく扱う  /W4: 警告を多めに出してミスに気づきやすくする
target_compile_options(RocksCellsBrowser PRIVATE /utf-8 /W4)

# 窓全体とデスクトップ（C5）。cppwinrt.exe は走らせない（SDK と食い違うとビルド全体が落ちる）。
# Windows SDK の C++/WinRT に CreateFreeThreaded があり、interop のヘッダもあるときだけ
# Windows.Graphics.Capture をコンパイルし、windowsapp・d3d11・dxgi をリンクする。
# ヘッダが無いときは GDI（BitBlt）だけでビルドする。C++ の標準は上の C++20 のまま。
if(WIN32)
  set(_honeycomb_kits_root "")
  cmake_host_system_information(
    RESULT _honeycomb_kits_root
    QUERY WINDOWS_REGISTRY "HKLM/SOFTWARE/Microsoft/Windows Kits/Installed Roots"
    VALUE "KitsRoot10"
    VIEW HOST
    ERROR_VARIABLE _honeycomb_kits_error)
  set(_honeycomb_kit_ver "${CMAKE_VS_WINDOWS_TARGET_PLATFORM_VERSION}")
  if(NOT _honeycomb_kit_ver)
    set(_honeycomb_kit_ver "${CMAKE_SYSTEM_VERSION}")
  endif()
  set(_honeycomb_wgc_on FALSE)
  if(_honeycomb_kits_root AND _honeycomb_kit_ver)
    set(_honeycomb_cppwinrt "${_honeycomb_kits_root}/Include/${_honeycomb_kit_ver}/cppwinrt")
    set(_honeycomb_wgc_header "${_honeycomb_cppwinrt}/winrt/Windows.Graphics.Capture.h")
    set(_honeycomb_wgc_interop "${_honeycomb_kits_root}/Include/${_honeycomb_kit_ver}/um/windows.graphics.capture.interop.h")
    if(EXISTS "${_honeycomb_wgc_header}" AND EXISTS "${_honeycomb_wgc_interop}")
      file(STRINGS "${_honeycomb_wgc_header}" _honeycomb_wgc_free REGEX "CreateFreeThreaded")
      if(_honeycomb_wgc_free)
        set(_honeycomb_wgc_on TRUE)
        target_include_directories(RocksCellsBrowser PRIVATE "${_honeycomb_cppwinrt}")
        target_compile_definitions(RocksCellsBrowser PRIVATE ROCKSCELLS_HAS_WGC)
        target_link_libraries(RocksCellsBrowser PRIVATE windowsapp d3d11 dxgi)
      endif()
    endif()
  endif()
  if(_honeycomb_wgc_on)
    message(STATUS "Windows.Graphics.Capture: ${_honeycomb_cppwinrt}")
  else()
    message(STATUS "Windows.Graphics.Capture headers not found; window and desktop capture will use BitBlt")
  endif()

  # 中央の録画（C6）。Media Foundation のヘッダが、上で見た Windows SDK にあるときだけ
  # コンパイルし、mfplat・mfreadwrite・mfuuid をリンクする。無いときは録画を出さず、ビルドは通す。
  # cppwinrt.exe は走らせない。C++/WinRT の名前空間は、この録画では使わない（画素は DevTools）。
  set(_honeycomb_record_on FALSE)
  if(_honeycomb_kits_root AND _honeycomb_kit_ver)
    set(_honeycomb_um "${_honeycomb_kits_root}/Include/${_honeycomb_kit_ver}/um")
    if(EXISTS "${_honeycomb_um}/mfapi.h" AND EXISTS "${_honeycomb_um}/mfidl.h" AND EXISTS "${_honeycomb_um}/mfreadwrite.h")
      set(_honeycomb_record_on TRUE)
      target_compile_definitions(RocksCellsBrowser PRIVATE ROCKSCELLS_HAS_RECORD)
      target_link_libraries(RocksCellsBrowser PRIVATE mfplat mfreadwrite mfuuid)
    endif()
  endif()
  if(_honeycomb_record_on)
    message(STATUS "Media Foundation recording: ${_honeycomb_um}")
  else()
    message(STATUS "Media Foundation headers not found; center recording will be omitted")
  endif()

  # 文字の読み取り（C7）。cppwinrt.exe は走らせない。
  # Windows.Media.Ocr と Windows.Graphics.Imaging の C++/WinRT ヘッダがあるときだけ
  # ROCKSCELLS_HAS_OCR を定義する。windowsapp は、C5 でまだリンクしていなければここで足す。
  # ヘッダが無いときは「文字を読む」を出さず、ビルドは通す。
  set(_honeycomb_ocr_on FALSE)
  if(_honeycomb_kits_root AND _honeycomb_kit_ver)
    if(NOT _honeycomb_cppwinrt)
      set(_honeycomb_cppwinrt "${_honeycomb_kits_root}/Include/${_honeycomb_kit_ver}/cppwinrt")
    endif()
    set(_honeycomb_ocr_header "${_honeycomb_cppwinrt}/winrt/Windows.Media.Ocr.h")
    set(_honeycomb_imaging_header "${_honeycomb_cppwinrt}/winrt/Windows.Graphics.Imaging.h")
    if(EXISTS "${_honeycomb_ocr_header}" AND EXISTS "${_honeycomb_imaging_header}")
      set(_honeycomb_ocr_on TRUE)
      if(NOT _honeycomb_wgc_on)
        target_include_directories(RocksCellsBrowser PRIVATE "${_honeycomb_cppwinrt}")
        target_link_libraries(RocksCellsBrowser PRIVATE windowsapp)
      endif()
      target_compile_definitions(RocksCellsBrowser PRIVATE ROCKSCELLS_HAS_OCR)
    endif()
  endif()
  if(_honeycomb_ocr_on)
    message(STATUS "Windows.Media.Ocr: ${_honeycomb_cppwinrt}")
  else()
    message(STATUS "Windows.Media.Ocr headers not found; text reading will be omitted")
  endif()
endif()

# ---------- TypeScript の UI ----------
# ui/ をビルドして、exe の横の ui フォルダへコピーする
find_program(NPM_EXECUTABLE NAMES npm.cmd npm REQUIRED)
set(UI_DIR ${CMAKE_SOURCE_DIR}/ui)
if(NOT EXISTS ${UI_DIR}/node_modules)
  message(STATUS "Installing UI packages (npm install)")
  execute_process(COMMAND ${NPM_EXECUTABLE} install WORKING_DIRECTORY ${UI_DIR} COMMAND_ERROR_IS_FATAL ANY)
endif()
set(UI_OUT ${CMAKE_BINARY_DIR}/$<CONFIG>/ui)
add_custom_target(ui ALL
  COMMAND ${NPM_EXECUTABLE} run build
  COMMAND ${CMAKE_COMMAND} -E rm -rf ${UI_OUT}
  COMMAND ${CMAKE_COMMAND} -E copy_directory ${UI_DIR}/dist ${UI_OUT}
  WORKING_DIRECTORY ${UI_DIR}
  COMMENT "Building the TypeScript UI"
  VERBATIM
)
add_dependencies(RocksCellsBrowser ui)

configure_file(src/res/version.h.in ${CMAKE_BINARY_DIR}/generated/version.h @ONLY)
configure_file(src/res/version.rc.in ${CMAKE_BINARY_DIR}/generated/version.rc @ONLY)
target_sources(RocksCellsBrowser PRIVATE ${CMAKE_BINARY_DIR}/generated/version.rc)
target_include_directories(RocksCellsBrowser PRIVATE ${CMAKE_BINARY_DIR}/generated)

# Optional Grok Bot / external-bot features (off by default for public builds)
option(ROCKSCELLS_BOT_FEATURES "Enable Grok Bot / relay features" OFF)
if(ROCKSCELLS_BOT_FEATURES)
  target_compile_definitions(RocksCellsBrowser PRIVATE ROCKSCELLS_BOT_FEATURES)
endif()

# ---------- Built-in hex-memo (web build) ----------
# Copies hex-memo's dist-web next to the exe as "hexmemo" (opened at https://hexmemo.local/).
# Build it first with:  cd ../hex-memo && npm.cmd run build:web
set(HEXMEMO_WEB_DIR "${CMAKE_SOURCE_DIR}/../hex-memo/dist-web" CACHE PATH "hex-memo dist-web folder to embed")
if(EXISTS "${HEXMEMO_WEB_DIR}/index.html")
  message(STATUS "Embedding hex-memo web build: ${HEXMEMO_WEB_DIR}")
  add_custom_command(TARGET RocksCellsBrowser POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E rm -rf "$<TARGET_FILE_DIR:RocksCellsBrowser>/hexmemo"
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${HEXMEMO_WEB_DIR}" "$<TARGET_FILE_DIR:RocksCellsBrowser>/hexmemo"
    VERBATIM)
else()
  message(STATUS "hex-memo web build not found (${HEXMEMO_WEB_DIR}); the built-in hex-memo will be missing")
endif()