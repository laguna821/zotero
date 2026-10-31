preferences-window =
    .title = { -app-name } Settings
preferences-appearance-title = Appearance and Language
preferences-auto-recognize-files =
    .label = Automatically retrieve metadata for PDFs and ebooks
preferences-file-renaming-title = File Renaming
preferences-file-renaming-intro = { -app-name } can automatically rename files based on the details of the parent item (title, author, etc.) and keep the filenames in sync as you make changes. Downloaded files are always initially named based on the parent item.
preferences-file-renaming-configure-button =
    .label = Configure File Renaming…
preferences-attachment-titles-title = Attachment Titles
preferences-attachment-titles-intro = Attachment titles are <label data-l10n-name="wiki-link">different from filenames</label>. To support some workflows, { -app-name } can show filenames instead of attachment titles in the items list.
preferences-attachment-titles-show-filenames =
    .label = Show attachment filenames in the items list
preferences-reader-title = Reader
preferences-reader-open-epubs-using = Open EPUBs using
preferences-reader-open-snapshots-using = Open snapshots using
preferences-reader-open-in-new-window =
    .label = Open files in new windows instead of tabs
preferences-reader-auto-disable-tool =
    .label = Turn off note, text, and image annotation tools after each use
preferences-reader-ebook-font = Ebook font:
preferences-reader-ebook-hyphenate =
    .label = Enable automatic hyphenation
preferences-read-aloud-title = Read Aloud
preferences-read-aloud-highlight-granularity = Highlight current
preferences-read-aloud-highlight-granularity-paragraph =
    .label = paragraph
preferences-read-aloud-highlight-granularity-sentence =
    .label = sentence
preferences-read-aloud-highlight-granularity-word =
    .label = word
preferences-note-title = 노트
preferences-note-open-in-new-window =
    .label = Open notes in new windows instead of tabs
preferences-color-scheme = Color Scheme:
preferences-color-scheme-auto =
    .label = 자동
preferences-color-scheme-light =
    .label = Light
preferences-color-scheme-dark =
    .label = Dark
preferences-item-pane-header = Item Pane Header:
preferences-item-pane-header-style = Header Citation Style:
preferences-item-pane-header-locale = Header Language:
preferences-item-pane-header-missing-style = Missing style: <{ $shortName }>
preferences-locate-library-lookup-intro = Library Lookup can find a resource online using your library’s OpenURL resolver.
preferences-locate-resolver = 해독기:
preferences-locate-base-url = Base URL:
preferences-quickCopy-minus =
    .aria-label = { general-remove }
    .label = { $label }
preferences-quickCopy-plus =
    .aria-label = { general-add }
    .label = { $label }
preferences-styleManager-intro = { -app-name } can generate citations and bibliographies in over 10,000 citation styles. Add styles here to make them available when selecting styles throughout { -app-name }.
preferences-styleManager-get-additional-styles =
    .label = Get Additional Styles…
preferences-styleManager-restore-default =
    .label = Restore Default Styles…
preferences-styleManager-add-from-file =
    .tooltiptext = Add a style from a file
    .label = Add from File…
preferences-styleManager-remove = Press { delete-or-backspace } to remove this style.
preferences-citation-dialog = Citation Dialog
preferences-citation-dialog-mode = Citation Dialog Mode:
preferences-citation-dialog-mode-last-used =
    .label = Last Used
preferences-citation-dialog-mode-list =
    .label = List Mode
preferences-citation-dialog-mode-library =
    .label = Library Mode
preferences-advanced-enable-local-api =
    .label = Allow other applications on this computer to communicate with { -app-name }
preferences-advanced-local-api-available = Available at <code data-l10n-name="url">{ $url }</span>
preferences-advanced-local-api-clear-authorizations =
    .label = Clear Write Authorizations
preferences-advanced-server-disabled = The { -app-name } HTTP server is disabled.
preferences-advanced-server-enable-and-restart =
    .label = Enable and Restart
preferences-advanced-language-and-region-title = Language and Region
preferences-advanced-enable-bidi-ui =
    .label = Enable bidirectional text editing utilities
preferences-advanced-data-dir =
    .value = Data Directory:
preferences-advanced-reset-data-dir =
    .label = Revert to Default Location…
preferences-advanced-custom-data-dir =
    .label = Use Custom Location…
preferences-advanced-default-data-dir =
    .value = (Default: { $directory })
    .aria-label = Default location
preferences-pane-account = Account
-preferences-sync-data-syncing = 데이터 동기화
preferences-sync-data-syncing-groupbox =
    .aria-label = { -preferences-sync-data-syncing }
preferences-sync-data-syncing-heading = { -preferences-sync-data-syncing }
preferences-sync-data-syncing-description = Log in with your { -app-name } account to sync your data between devices, collaborate with others, and more.
preferences-sync-settings-heading = 동기화
preferences-sync-settings-intro = { -app-name } can sync your library data and files across devices. <label data-l10n-name="sync-link">Learn more</label>
preferences-sync-reset-heading = Sync Reset
preferences-sync-fileSyncing-groups =
    .label = Sync attachment files in group libraries using { -app-name } Storage
preferences-sync-fileSyncing-tos = By using { -app-name } Storage, you agree to become bound by its <label data-l10n-name="terms-link">terms and conditions</label>.
preferences-account-log-out =
    .label = Log Out…
preferences-sync-reset-restore-to-server-body = { -app-name } will replace “{ $libraryName }” on { $domain } with data from this computer.
preferences-sync-reset-restore-to-server-deleted-items-text =
    { $remoteItemsDeletedCount } { $remoteItemsDeletedCount ->
        [one] item
       *[other] items
    } in the online library will be permanently deleted.
preferences-sync-reset-restore-to-server-remaining-items-text =
    { general-sentence-separator }{ $localItemsCount ->
        [0] The library on this computer and the online library will be empty.
        [one] 1 item will remain on this computer and in the online library.
       *[other] { $localItemsCount } items will remain on this computer and in the online library.
    }
preferences-sync-reset-restore-to-server-checkbox-label =
    { $remoteItemsDeletedCount ->
        [one] Delete 1 item
       *[other] Delete { $remoteItemsDeletedCount } items
    }
preferences-sync-reset-restore-to-server-confirmation-text = delete online library
preferences-sync-reset-restore-to-server-yes = 온라인 라이브러리의 데이터 교체
preferences-account-log-in =
    .label = Log In
preferences-account-waiting-for-login =
    .value = Waiting for login…
preferences-account-cancel-button =
    .label = { general-cancel }
preferences-account-logged-out-status =
    .value = (logged out)
preferences-account-email-label =
    .value = Email:
preferences-account-switch-accounts =
    .label = Switch Accounts…
preferences-account-switch-text = Switching to a different account will remove all { -app-name } data on this computer. Before continuing, make sure all data and files you wish to keep have been synced with the “{ $username }” account or you have a backup of your { -app-name } data directory.
preferences-account-switch-confirmation-text = remove local data
preferences-account-switch-accept = Remove Data and Restart
fulltext-index-status-indexing = Indexing { $indexed } of { $total }…
fulltext-index-status-complete = Search index is up to date
fulltext-stats-attachments-indexed = Attachments indexed:
fulltext-stats-partially-indexed = Partially indexed:
fulltext-stats-not-available = Full-text content or file not available:
fulltext-stats-notes-indexed = Notes indexed:

## Dropbox file sync

preferences-sync-dropbox-intro = 내 라이브러리의 첨부파일은 Dropbox에 저장합니다. 문헌 정보·메모·주석은 지금처럼 { -app-name } 계정으로 동기화합니다.
preferences-sync-dropbox-setup-hint = <label data-l10n-name="app-console-link">Dropbox App Console</label>에서 “App folder” 접근 방식으로 앱을 만들고, Permissions 탭에서 files.content.write, files.content.read, files.metadata.read를 켠 뒤 맨 아래 Submit을 누르세요. Settings 탭의 Redirect URIs에 아래 주소를 추가한 다음 App key를 여기에 붙여 넣으세요. 나중에 권한을 바꾸면 ‘다시 연결’을 눌러야 적용됩니다.
preferences-sync-dropbox-redirect-uri = 리디렉션 주소:
preferences-sync-dropbox-app-key = 앱 키:
preferences-sync-dropbox-folder = 폴더:
preferences-sync-dropbox-account = 계정:
preferences-sync-dropbox-connected = { $account }
preferences-sync-dropbox-connected-unknown = 연결됨
preferences-sync-dropbox-not-connected = 연결되지 않음
preferences-sync-dropbox-connect =
    .label = Dropbox 연결…
preferences-sync-dropbox-verify =
    .label = 연결 확인
preferences-sync-dropbox-reconnect =
    .label = 다시 연결…
preferences-sync-dropbox-reconnect-title = Dropbox 다시 연결
preferences-sync-dropbox-reconnect-text = Dropbox 승인은 처음 허용할 때의 권한만 계속 갖습니다. Dropbox App Console의 Permissions 탭에서 이 권한을 켜고 맨 아래 Submit을 누른 뒤, 다시 연결해 새로 허용하세요.
preferences-sync-dropbox-reconnect-now = 다시 연결
preferences-sync-dropbox-open-app-console = App Console 열기
preferences-sync-dropbox-disconnect =
    .label = 연결 해제
preferences-sync-dropbox-waiting = 브라우저에서 접근을 허용하세요…
preferences-sync-dropbox-enter-code =
    .label = 코드로 연결…
preferences-sync-dropbox-cancel =
    .label = 취소
preferences-sync-dropbox-enter-code-title = Dropbox 연결
preferences-sync-dropbox-enter-code-text = 브라우저에서 접근을 허용한 뒤 Dropbox가 보여 주는 코드를 붙여 넣으세요:
preferences-sync-dropbox-set-up = Dropbox 파일 동기화가 준비되었습니다. 내 라이브러리의 첨부파일은 Dropbox 앱 폴더의 “{ $folder }”에 저장됩니다.
preferences-sync-dropbox-disconnect-confirm = Dropbox 연결을 해제할까요? Dropbox에 이미 저장된 파일은 그대로 남습니다.
preferences-sync-dropbox-migrate-hint = { -app-name } Storage에서 옮겨 오나요? 이 컴퓨터에 없는 파일은 Dropbox에 올릴 수 없으니 먼저 { -app-name } Storage에서 받아 두세요.
preferences-sync-dropbox-download-missing =
    .label = { -app-name } Storage에서 빠진 파일 받기…
preferences-sync-dropbox-download-missing-progress =
    .label = { $total }개 중 { $current }번째 받는 중…
preferences-sync-dropbox-download-missing-no-account = 먼저 { -app-name } 계정으로 로그인하세요.
preferences-sync-dropbox-download-missing-none = 내 라이브러리의 첨부파일이 모두 이 컴퓨터에 있습니다.
preferences-sync-dropbox-download-missing-confirm = 이 컴퓨터에 없는 파일 { $count }개를 { -app-name } Storage에서 받을까요?
preferences-sync-dropbox-download-missing-done = 받은 파일: { $downloaded }개. 받을 수 없는 파일: { $failed }개. 받은 파일은 다음 동기화 때 Dropbox에 올라갑니다.
preferences-sync-dropbox-groups-note = 그룹 라이브러리의 첨부파일은 항상 { -app-name } Storage로 동기화합니다.
