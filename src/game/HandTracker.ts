import { Hands, Results, HAND_CONNECTIONS } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';

export type GestureType = 'NONE' | 'THUNDER' | 'FIRE' | 'WIND' | 'SHADOW' | 'FIST' | 'ALL';

export interface GestureDebugInfo {
  thumb: boolean;
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
  isPalmInward: boolean;
}

export class HandTracker {
  private hands: Hands;
  private camera: Camera | null = null;
  private videoElement: HTMLVideoElement;
  private onResultsCallback: (gesture: GestureType, results: Results, rawGesture: GestureType, debugInfo: GestureDebugInfo) => void = () => {};
  private lastGesture: GestureType = 'NONE';
  private lastGestureTime: number = 0;
  private isRunning: boolean = false;
  
  private gestureHistory: GestureType[] = [];
  private readonly GESTURE_HISTORY_LEN = 3;
  private readonly GESTURE_TRIGGER_THRESH = 2;

  constructor(videoElement: HTMLVideoElement) {
    this.videoElement = videoElement;
    
    this.hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
      }
    });

    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.3,
      minTrackingConfidence: 0.3
    });

    this.hands.onResults((results) => {
      this.processResults(results);
    });
  }

  public setOnResults(callback: (gesture: GestureType, results: Results, rawGesture: GestureType, debugInfo: GestureDebugInfo) => void) {
    this.onResultsCallback = callback;
  }

  public async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    this.camera = new Camera(this.videoElement, {
      onFrame: async () => {
        if (this.isRunning) {
          await this.hands.send({ image: this.videoElement });
        }
      },
      width: 640,
      height: 480
    });
    
    await this.camera.start();
  }

  public stop() {
    this.isRunning = false;
    if (this.camera) {
      this.camera.stop();
    }
  }

  private getStableGesture(currentGesture: GestureType): GestureType {
    this.gestureHistory.push(currentGesture);
    if (this.gestureHistory.length > this.GESTURE_HISTORY_LEN) {
      this.gestureHistory.shift();
    }

    const count: Record<string, number> = {};
    for (const g of this.gestureHistory) {
      count[g] = (count[g] || 0) + 1;
    }

    for (const g in count) {
      if (count[g] >= this.GESTURE_TRIGGER_THRESH) {
        return g as GestureType;
      }
    }
    return 'NONE';
  }

  private calculateAngle(p1: any, p2: any, p3: any): number {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y, z: p1.z - p2.z };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y, z: p3.z - p2.z };
    const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);
    if (mag1 === 0 || mag2 === 0) return 0;
    const cosTheta = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return Math.acos(cosTheta) * (180 / Math.PI);
  }

  private isFingerExtended(landmarks: any[], finger: 'THUMB'|'INDEX'|'MIDDLE'|'RING'|'PINKY'): boolean {
    if (finger === 'THUMB') {
      const tip = landmarks[4];
      const ip = landmarks[3];
      const mcp = landmarks[2];
      const angle = this.calculateAngle(tip, ip, mcp);
      return angle > 150 || tip.y < ip.y + 0.03;
    } else {
      const tipIdx = finger === 'INDEX' ? 8 : finger === 'MIDDLE' ? 12 : finger === 'RING' ? 16 : 20;
      const tip = landmarks[tipIdx];
      const pip = landmarks[tipIdx - 2];
      const mcp = landmarks[tipIdx - 3];
      const angle = this.calculateAngle(tip, pip, mcp);
      return angle > 150 || tip.y < pip.y + 0.02;
    }
  }

  private isPalmInward(landmarks: any[]): boolean {
    const wrist = landmarks[0];
    const palmBase = landmarks[9];
    const pinkyBase = landmarks[17];
    const v1 = { x: palmBase.x - wrist.x, y: palmBase.y - wrist.y, z: palmBase.z - wrist.z };
    const v2 = { x: pinkyBase.x - wrist.x, y: pinkyBase.y - wrist.y, z: pinkyBase.z - wrist.z };
    
    const normal = {
        x: v1.y * v2.z - v1.z * v2.y,
        y: v1.z * v2.x - v1.x * v2.z,
        z: v1.x * v2.y - v1.y * v2.x
    };
    
    const len = Math.hypot(normal.x, normal.y, normal.z);
    if (len === 0) return false;
    const unit = { x: normal.x / len, y: normal.y / len, z: normal.z / len };
    
    return unit.z > 0.5;
  }

  private getPalmDirection(landmarks: any[]) {
    const wrist = landmarks[0];
    const palmBase = landmarks[9];
    const pinkyBase = landmarks[17];
    const v1 = { x: palmBase.x - wrist.x, y: palmBase.y - wrist.y, z: palmBase.z - wrist.z };
    const v2 = { x: pinkyBase.x - wrist.x, y: pinkyBase.y - wrist.y, z: pinkyBase.z - wrist.z };
    
    const normal = {
        x: v1.y * v2.z - v1.z * v2.y,
        y: v1.z * v2.x - v1.x * v2.z,
        z: v1.x * v2.y - v1.y * v2.x
    };
    
    const len = Math.hypot(normal.x, normal.y, normal.z);
    if (len === 0) return {x: 0, y: 0, z: 1};
    return { x: normal.x / len, y: normal.y / len, z: normal.z / len };
  }

  private processResults(results: Results) {
    let currentGesture: GestureType = 'NONE';
    let debugInfo: GestureDebugInfo = { thumb: false, index: false, middle: false, ring: false, pinky: false, isPalmInward: false };

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      if (results.multiHandLandmarks.length === 2) {
        if (this.checkAll(results.multiHandLandmarks[0], results.multiHandLandmarks[1])) {
          currentGesture = 'ALL';
        }
      }

      if (currentGesture === 'NONE') {
        const landmarks = results.multiHandLandmarks[0];
        
        const isThumbExt = this.isFingerExtended(landmarks, 'THUMB');
        const isIndexExt = this.isFingerExtended(landmarks, 'INDEX');
        const isMiddleExt = this.isFingerExtended(landmarks, 'MIDDLE');
        const isRingExt = this.isFingerExtended(landmarks, 'RING');
        const isPinkyExt = this.isFingerExtended(landmarks, 'PINKY');
        
        const palmInward = this.isPalmInward(landmarks);

        debugInfo = { thumb: isThumbExt, index: isIndexExt, middle: isMiddleExt, ring: isRingExt, pinky: isPinkyExt, isPalmInward: palmInward };

        const extendedCount = [isThumbExt, isIndexExt, isMiddleExt, isRingExt, isPinkyExt].filter(Boolean).length;
        const extendedCountNoThumb = [isIndexExt, isMiddleExt, isRingExt, isPinkyExt].filter(Boolean).length;

        // Priority: FIRE > SHADOW > WIND > THUNDER > FIST
        if (this.checkFire(landmarks)) currentGesture = 'FIRE';
        else if (this.checkShadow(landmarks)) currentGesture = 'SHADOW';
        else if (this.checkWind(extendedCount, palmInward)) currentGesture = 'WIND';
        else if (this.checkThunder(extendedCount, palmInward)) currentGesture = 'THUNDER';
        else if (this.checkFist(landmarks, extendedCountNoThumb)) currentGesture = 'FIST';
      }
    }

    let stableGesture = currentGesture;
    if (currentGesture !== 'ALL') {
      stableGesture = this.getStableGesture(currentGesture);
    } else {
      this.gestureHistory = []; // Reset history to avoid lingering
    }

    const now = Date.now();
    if (stableGesture !== 'NONE' && stableGesture !== 'FIST' && stableGesture === this.lastGesture) {
      if (now - this.lastGestureTime < 500) {
        this.onResultsCallback('NONE', results, currentGesture, debugInfo);
        return;
      }
    }

    if (stableGesture !== 'NONE') {
      this.lastGesture = stableGesture;
      this.lastGestureTime = now;
    }

    this.onResultsCallback(stableGesture, results, currentGesture, debugInfo);
  }

  private checkAll(hand1: any[], hand2: any[]): boolean {
    const wrist1 = hand1[0], wrist2 = hand2[0];
    const root1 = hand1[5], root2 = hand2[5];
    const distWrist = Math.hypot(wrist1.x - wrist2.x, wrist1.y - wrist2.y, wrist1.z - wrist2.z);
    const distRoot = Math.hypot(root1.x - root2.x, root1.y - root2.y, root1.z - root2.z);
    
    if (distWrist > 0.25 || distRoot > 0.25) return false;
    
    const palmDir1 = this.getPalmDirection(hand1);
    const palmDir2 = this.getPalmDirection(hand2);
    const dot = palmDir1.x * palmDir2.x + palmDir1.y * palmDir2.y + palmDir1.z * palmDir2.z;
    return dot < -0.5;
  }

  private checkFire(landmarks: any[]): boolean {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const dist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
    if (dist > 0.08) return false;
    
    const middleTip = landmarks[12], middleDip = landmarks[10];
    const ringTip = landmarks[16], ringDip = landmarks[14];
    const pinkyTip = landmarks[20], pinkyDip = landmarks[18];
    
    const middleBent = middleTip.y > middleDip.y - 0.02;
    const ringBent = ringTip.y > ringDip.y - 0.02;
    const pinkyBent = pinkyTip.y > pinkyDip.y - 0.02;
    
    const bentCount = (middleBent ? 1 : 0) + (ringBent ? 1 : 0) + (pinkyBent ? 1 : 0);
    return bentCount >= 2;
  }

  private checkShadow(landmarks: any[]): boolean {
    const indexTip = landmarks[8], indexDip = landmarks[6];
    const middleTip = landmarks[12], middleDip = landmarks[10];
    const indexStraight = indexTip.y < indexDip.y + 0.03;
    const middleStraight = middleTip.y < middleDip.y + 0.03;
    if (!indexStraight || !middleStraight) return false;
    
    const ringTip = landmarks[16], ringDip = landmarks[14];
    const pinkyTip = landmarks[20], pinkyDip = landmarks[18];
    const ringBent = ringTip.y > ringDip.y - 0.04;
    const pinkyBent = pinkyTip.y > pinkyDip.y - 0.04;
    if (!ringBent || !pinkyBent) return false;
    
    const fingerDist = Math.hypot(indexTip.x - middleTip.x, indexTip.y - middleTip.y);
    return fingerDist < 0.08;
  }

  private checkWind(extendedCount: number, isPalmInward: boolean): boolean {
    if (extendedCount < 3) return false;
    if (!isPalmInward) return false;
    return true;
  }

  private checkThunder(extendedCount: number, isPalmInward: boolean): boolean {
    if (extendedCount < 3) return false;
    if (isPalmInward) return false;
    return true;
  }

  private checkFist(landmarks: any[], extendedCountNoThumb: number): boolean {
    if (extendedCountNoThumb > 1) return false;
    
    let bentDownCount = 0;
    const tips = [8, 12, 16, 20];
    const pips = [6, 10, 14, 18];
    
    for (let i = 0; i < 4; i++) {
      if (landmarks[tips[i]].y > landmarks[pips[i]].y - 0.02) {
        bentDownCount++;
      }
    }
    
    return bentDownCount >= 3;
  }
}
