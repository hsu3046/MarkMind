/**
 * Convert 패널들이 공유하는 타입.
 * (이전엔 ConvertWindow.tsx 에 있었으나 통합 사이드바로 전환되며 분리)
 */

export interface DroppedFile {
    path: string;
    name: string;
}
