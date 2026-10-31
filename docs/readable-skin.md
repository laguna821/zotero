# 가독성 스킨

**보기 → 가독성 스킨**으로 켜고 끕니다. 기본값은 켜짐이고, 끄면 원래 Zotero 화면으로 바로 돌아갑니다.

*English summary: View → Readable Skin. Warmer surfaces, a muted Zotero-red selection, Pretendard, a clearer title/byline/section hierarchy, Korean line breaking between words, and empty item fields folded behind a "Show N Empty Fields" row. Turning it off restores the stock UI.*

## 바뀌는 것

| 영역 | 변경 |
|---|---|
| 색 | 종이 느낌의 따뜻한 밝은 바탕과 차콜 어두운 바탕. 선택 색은 차분한 붉은색(흰 글자 대비 4.5:1 이상) |
| 글꼴 | 설치된 Pretendard → 내장 Pretendard Variable → Apple SD Gothic Neo·맑은 고딕 순 |
| 문헌 목록 | 제목은 약간 굵게, 저자·연도 등 나머지 열은 흐리게 |
| 컬렉션 | 목록으로 포커스가 옮겨 가도 현재 컬렉션이 붉은 틴트로 보임 |
| 상세 창 | 제목을 크게, 섹션 이름을 진하게, 초록 줄간격 1.65, 한글은 낱말 단위로 줄바꿈 |
| 정보 칸 | 값이 없는 필드는 접고 **빈 필드 N개 보기** 줄로 펼침. 다른 문헌을 고르면 다시 접힘. 제목만 있는 새 문헌은 모든 필드를 보여 줌 |

## 바꾸지 않는 것

- 목록의 행 높이: Zotero가 글자 크기·밀도 설정으로 계산하므로 CSS로 건드리지 않습니다. 줄 간격을 넓히려면 **보기 → 밀도 → 넉넉하게**, **보기 → 글자 크기**를 쓰세요.
- PDF 리더와 메모 편집기의 문서 글꼴, 플러그인과 단축키, 데이터.

## 구현

- 스타일: `scss/themes/_readable.scss` (`:root[readableSkin]` 아래에만 적용)
- 켜고 끄기: `readableSkin` 설정 → `Zotero.UIProperties`가 각 창 루트에 속성을 붙임, 보기 메뉴 항목
- 빈 필드 접기: `chrome/content/zotero/elements/itemBox.js`
- 테스트: `test/tests/readableSkinTest.js`. 다른 테스트는 원래 화면을 검사하도록 테스트 실행기가 스킨을 끈 상태로 시작합니다.
- 글꼴: Pretendard 1.3.9 (SIL OFL 1.1), `chrome/skin/default/zotero/fonts/`
