Zotero에 Dropbox 파일 동기화, 가독성 스킨, Achmage Edition 표시를 더한 개인 빌드입니다. 공식 Zotero 팀이 만들거나 지원하는 빌드가 아닙니다.

## 설치

공식 Zotero와 같은 프로필·데이터 폴더를 쓰므로 기존 로그인, 설정, 플러그인이 그대로 이어집니다. 두 앱을 동시에 실행하지 말고, 이 빌드를 쓰는 컴퓨터에서는 공식 Zotero 대신 이 빌드만 쓰세요.

- **Windows**: `…_win-x64.zip`을 풀어 `zotero.exe`를 실행합니다(예: `%LOCALAPPDATA%\Programs\Zotero Achmage`에 두고 바로 가기 만들기). 처음 실행할 때 SmartScreen이 막으면 **추가 정보 → 실행**을 누릅니다.
- **macOS**: `…_mac.zip`을 풀어 `Zotero.app`을 `응용 프로그램`으로 옮긴 뒤 터미널에서 한 번 실행합니다.
  `xattr -dr com.apple.quarantine /Applications/Zotero.app`
  Apple 공증을 받지 않은 빌드라 이 단계가 필요합니다.
- **Linux**: `…_linux-x86_64.tar.xz`를 풀어 `zotero`를 실행합니다.

## 처음 설정

1. 설정 → 동기화에서 Zotero 계정으로 로그인합니다.
2. 파일 동기화 방식을 **Dropbox**로 바꾸고 안내에 따라 Dropbox를 연결합니다(`docs/dropbox-file-sync.md`).
3. **보기 → 가독성 스킨**으로 스킨을 켜고 끕니다.

zotero.org의 자동 업데이트는 꺼져 있습니다. 새 버전은 이 저장소의 Releases에서 받습니다. 각 파일의 SHA-256은 `SHA256SUMS-…` 파일에 있습니다.
