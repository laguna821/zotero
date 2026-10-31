# Achmage Edition 빌드와 배포

공식 Zotero 릴리스(`10.0.x`) 위에 기능 브랜치를 얹은 포크입니다.

| 브랜치 | 내용 |
|---|---|
| `custom/10.0` | 기준점 (공식 태그 그대로) |
| `feature/dropbox-file-sync` | Dropbox 파일 동기화 |
| `feature/readable-skin` | 가독성 스킨 |
| `feature/achmage-branding` | 로고·아이콘 |
| `build/cross-platform-release` | 이 문서, 빌드 스크립트, 업데이트 차단 |
| `achmage/10.0` | 위 브랜치를 합친 배포용 브랜치 |

## GitHub에서 빌드

**Actions → Achmage Edition release → Run workflow**를 누르면 Windows·macOS·Linux 설치본을 만들어 초안 릴리스에 올립니다. 확인한 뒤 **Publish**하세요. 평소 push로는 CI가 돌지 않습니다(`ci.yml`은 수동 실행).

## 직접 빌드 (Linux 또는 macOS)

```bash
git clone --recurse-submodules -b achmage/10.0 https://github.com/laguna821/zotero.git
cd zotero
git lfs pull
npm ci
app/scripts/fork_build          # -p w, -p m, -p l 로 플랫폼 선택
```

필요한 것: Node 22, zip·unzip, 7-Zip 22 이상(`7z`), rsync, perl, python3, xz, curl, Git LFS. Windows 설치 프로그램에는 NSIS 3(`makensis`)이나 Wine이 필요합니다(Wine만 있으면 Windows용 NSIS를 내려받아 실행). Linux에서 macOS 설치본을 만들려면 [rcodesign](https://github.com/indygreg/apple-platform-rs)도 필요합니다. Wine이 있으면 `zotero.exe`와 설치 프로그램에도 Achmage 아이콘을 넣습니다.

결과는 `app/dist-achmage/`에 생깁니다.

- Windows: `…_x64_setup.exe` 설치 프로그램. 공식 Zotero와 같은 곳(`C:\Program Files\Zotero`)에 설치되어 공식 Zotero를 대신합니다.
- macOS: 임시(ad hoc) 서명한 `Zotero.app` zip. Apple 공증이 없으므로 설치 후 `xattr -dr com.apple.quarantine`가 필요합니다.
- Linux: tar.xz

버전은 `10.0.7-achmage.N+커밋`처럼 붙습니다.

## Linux에서 macOS·Windows 빌드가 되는 이유

- Firefox macOS 런타임은 디스크 이미지(DMG)라 Linux에서 마운트할 수 없습니다. `fork_build`가 Mozilla 체크섬을 확인한 뒤 7-Zip으로 풀어 `fetch_xulrunner`가 쓰는 zip을 만듭니다.
- macOS용 `codesign` 대신 `rcodesign`으로 앱 전체를 임시 서명합니다. Apple Silicon은 서명 없는 앱을 실행하지 않습니다.
- `set-channel-prefs-channel`은 Linux의 GNU `strings`로도 동작하게 고쳤습니다.
- `build.sh`는 Windows 설치 프로그램을 Windows에서만 만듭니다. `fork_build`는 같은 `app/win/installer` 스크립트를 NSIS 3로 컴파일하고(NSIS 2 유니코드판용 스크립트라 `Unicode true`를 붙임) 공식 설치 프로그램처럼 7-Zip 자동 압축 풀기 파일로 묶습니다. 내려받는 NSIS와 플러그인은 체크섬을 확인합니다.

## 공식 업데이트를 끈 이유

공식 업데이트를 받으면 이 포크가 일반 Zotero로 덮여 Dropbox 기능이 사라집니다. 그래서 `application.ini`에서 업데이트 주소를 뺐고, **도움말 → 업데이트 확인**은 이 저장소의 Releases를 엽니다.

## 공식 새 버전 따라가기

```bash
git fetch upstream --tags
git checkout custom/10.0 && git reset --hard 10.0.8      # 새 태그
for b in feature/dropbox-file-sync feature/readable-skin feature/achmage-branding build/cross-platform-release; do
	git checkout $b && git rebase custom/10.0
done
git checkout achmage/10.0 && git reset --hard custom/10.0
for b in feature/dropbox-file-sync feature/readable-skin feature/achmage-branding build/cross-platform-release; do
	git merge --no-edit $b
done
```

충돌이 나면 각 기능 브랜치에서 해결한 뒤 다시 합칩니다. 새 Zotero가 데이터베이스 형식을 바꿨다면, 공식 Zotero로 한 번 연 데이터는 그보다 오래된 이 빌드로 열 수 없으니 순서에 주의하세요.
