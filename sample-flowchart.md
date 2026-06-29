# 문서 작성 승인 흐름

이 파일은 **Flowchart View** 와 **Rich Text 모드**에서 `markmind-flow` 코드블록 보존을 확인하기 위한 샘플입니다.

- Flowchart view에서는 아래 JSON이 다이어그램으로 표시됩니다.
- Rich Text 모드에서는 같은 블록이 시각적인 flowchart 블록으로 표시됩니다.
- Markdown으로 다시 전환해도 `markmind-flow` JSON이 그대로 보존되어야 합니다.

```markmind-flow
{
  "title": "문서 작성 승인 흐름",
  "direction": "LR",
  "nodes": [
    {
      "id": "start",
      "type": "start",
      "label": "Draft 작성",
      "description": "초안 문서를 작성한다",
      "position": {
        "x": 0,
        "y": 0
      }
    },
    {
      "id": "review",
      "type": "process",
      "label": "리뷰 요청",
      "description": "담당자에게 검토를 요청한다",
      "position": {
        "x": 260,
        "y": 0
      }
    },
    {
      "id": "approved",
      "type": "decision",
      "label": "승인?",
      "description": "수정 없이 승인 가능한지 판단한다",
      "position": {
        "x": 520,
        "y": 0
      }
    },
    {
      "id": "revise",
      "type": "process",
      "label": "수정 반영",
      "description": "리뷰 의견을 반영한다",
      "position": {
        "x": 520,
        "y": 190
      }
    },
    {
      "id": "publish",
      "type": "end",
      "label": "게시",
      "description": "승인된 문서를 배포한다",
      "position": {
        "x": 790,
        "y": 0
      }
    }
  ],
  "edges": [
    {
      "id": "e-start-review",
      "source": "start",
      "target": "review"
    },
    {
      "id": "e-review-approved",
      "source": "review",
      "target": "approved"
    },
    {
      "id": "e-approved-publish",
      "source": "approved",
      "target": "publish",
      "sourceHandle": "yes",
      "label": "Yes",
      "type": "conditional"
    },
    {
      "id": "e-approved-revise",
      "source": "approved",
      "target": "revise",
      "sourceHandle": "no",
      "label": "No",
      "type": "conditional"
    },
    {
      "id": "e-revise-review",
      "source": "revise",
      "target": "review",
      "label": "재검토",
      "markerLoop": true
    }
  ]
}
```
