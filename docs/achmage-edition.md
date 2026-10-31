# Achmage Edition 표시

공식 Zotero와 구분되도록 이 포크에는 Achmage 로고가 들어갑니다.

| 위치 | 표시 |
|---|---|
| 앱 아이콘 (Dock·작업 표시줄·시작 메뉴·바탕화면) | Zotero 아이콘 오른쪽 아래에 Achmage 배지 |
| 메인 창 탭 줄 오른쪽 | `Achmage.` 로고 — 누르면 정보 창 |
| 도움말 → Zotero 정보 | 로고, Achmage Edition 설명, 소스·새 버전 링크 |

어두운 모드에서는 로고의 남색(#002e6e)이 밝은 색(#e9f3ff)으로 바뀝니다. 청록(#00b5ad)은 그대로입니다.

## 파일

- 로고: `chrome/skin/default/zotero/achmage/wordmark.svg`, `mark.svg` (남색 부분은 `context-fill`)
- 아이콘 생성: `python3 app/branding/generate-icons.py` (Pillow, rsvg-convert 필요)
  - 입력: `app/branding/zotero-original.ico`(원래 Zotero 아이콘), `app/branding/badge.svg`
  - 출력: `app/linux/icons/`, `app/win/zotero.ico`, `app/mac/Contents/Resources/zotero.icns`, `app/branding/window-icons/`
- Mac은 `Info.plist`의 `CFBundleIconFile`로 `zotero.icns`를 씁니다. Windows 실행 파일과 창 아이콘은 포크 빌드 스크립트가 넣습니다.

원래 Zotero 아이콘은 256px까지만 있어 Mac의 512·1024px 아이콘은 확대본입니다.
