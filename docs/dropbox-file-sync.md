# Dropbox 파일 동기화

이 포크는 Zotero의 파일 동기화 방식에 **Dropbox**를 추가합니다. 문헌 정보·메모·주석은 지금처럼 Zotero 계정으로 동기화하고, 내 라이브러리의 첨부파일(PDF 등)은 Zotero Storage 대신 Dropbox에 저장합니다.

*English summary: adds Dropbox as a file sync method for My Library. Item data still syncs with the Zotero account. Files are stored in a Dropbox app folder in the same `KEY.zip` + `KEY.prop` layout as WebDAV.*

## 1. Dropbox 앱 만들기 (한 번만)

Dropbox는 앱마다 접근 권한을 따로 받습니다. 본인 계정에 전용 앱을 하나 만드세요.

1. <https://www.dropbox.com/developers/apps> → **Create app**
2. **Scoped access** → **App folder** → 이름 입력(예: `Zotero Files`) → 만들기
3. **Permissions** 탭에서 아래 네 가지를 켜고 **Submit**
   - `files.metadata.read`
   - `files.content.read`
   - `files.content.write`
   - `account_info.read` (계정 이름 표시용, 기본으로 켜져 있음)
4. **Settings** 탭
   - **Redirect URIs**에 `http://localhost:23119/dropbox/oauth` 추가
     (Zotero 설정의 동기화 화면에 표시되는 주소와 같아야 합니다)
   - **App key** 복사 (App secret은 필요 없습니다)

권한을 바꾼 뒤에는 Zotero에서 Dropbox를 다시 연결해야 새 권한이 적용됩니다.

## 2. Zotero에서 연결하기

1. 설정 → **동기화** → Zotero 계정으로 로그인
2. **파일 동기화** → 내 라이브러리 방식에서 **Dropbox** 선택
3. **앱 키**에 복사한 App key를 붙여 넣기
4. **Dropbox 연결…** → 브라우저에서 **허용** → 자동으로 연결 확인까지 진행
   - 브라우저가 Zotero로 돌아오지 못하면 **코드로 연결…**을 누르고, Dropbox가 보여 주는 코드를 붙여 넣습니다.

파일은 Dropbox의 `앱/<앱 이름>/zotero/` 폴더에 저장됩니다. 폴더 이름은 설정에서 바꿀 수 있습니다.

## 3. Zotero Storage에서 옮겨 올 때

이 컴퓨터에 없는 파일은 Dropbox에 올릴 수 없습니다. 방식을 Dropbox로 바꾼 뒤 아래 순서로 진행하세요.

1. **Zotero Storage에서 빠진 파일 받기…**를 누릅니다. Zotero Storage에만 있던 파일을 이 컴퓨터로 받습니다.
2. 동기화 버튼을 누릅니다. 내 라이브러리의 모든 첨부파일을 Dropbox에 올립니다.
3. 다른 컴퓨터에서는 이 포크를 설치하고 같은 앱 키로 Dropbox를 연결합니다. 파일은 Dropbox에서 받습니다.

Zotero Storage에 있던 파일은 지우지 않습니다. 백업으로 남기거나 zotero.org 계정 설정에서 직접 정리할 수 있습니다.

## 알아 둘 점

- **모든 데스크톱에서 같은 방식을 쓰세요.** 한 컴퓨터는 Zotero Storage, 다른 컴퓨터는 Dropbox를 쓰면 파일이 두 곳에 나뉘어 서로 받지 못합니다.
- **그룹 라이브러리**의 첨부파일은 계속 Zotero Storage로 동기화합니다.
- **공식 모바일 앱**은 Dropbox에서 파일을 직접 읽지 못합니다. 저장 형식이 WebDAV와 같으므로 `rclone serve webdav`처럼 Dropbox 폴더를 WebDAV로 열어 주는 중계기를 두면 공식 앱의 WebDAV 설정으로 같은 파일을 쓸 수 있습니다.
- Dropbox 데스크톱 앱이 이 폴더까지 내려받으면 같은 파일이 컴퓨터에 두 번 저장됩니다. 필요하면 Dropbox의 선택적 동기화나 온라인 전용 설정에서 `앱/<앱 이름>` 폴더를 제외하세요.
- 한 폴더를 두 개의 Zotero 계정이 함께 쓰면 안 됩니다. 다른 계정의 파일을 고아 파일로 보고 일주일 뒤 지울 수 있습니다. WebDAV와 같은 규칙입니다.
- 접근 토큰은 OS 키체인으로 암호화해 Zotero 로그인 저장소에 둡니다. **연결 해제**를 누르면 Dropbox 쪽 토큰도 취소합니다.

## 동작 방식

- 저장 형식: `항목키.zip`(첨부파일 묶음)과 `항목키.prop`(수정 시각·MD5). Zotero WebDAV 동기화와 같습니다.
- 변경 감지: WebDAV처럼 파일의 수정 시각과 해시를 Zotero 데이터 동기화에 기록합니다. 다른 컴퓨터는 이 기록을 보고 받을 파일을 정합니다.
- 충돌: 같은 파일을 두 컴퓨터에서 고친 경우 Zotero의 기존 파일 충돌 창이 뜹니다.
- 큰 파일: 140MB를 넘으면 32MB씩 나눠 올립니다.
- 구현: `chrome/content/zotero/xpcom/storage/dropbox.js`, 테스트: `test/tests/dropboxTest.js`
