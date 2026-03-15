// Shared reactive state for chart interactivity across all chart components

export interface PinnedAnnotation {
  id: string;
  driver: string;
  driverNum: number;
  lap: number;
  value: string;
  color: string;
  chartType: 'laptime' | 'gap' | 'position';
}

class ChartState {
  hiddenDrivers = $state<number[]>([]);
  lapRange = $state<[number, number]>([1, 999]);
  pinnedAnnotations = $state<PinnedAnnotation[]>([]);

  toggle(num: number) {
    if (this.hiddenDrivers.includes(num)) {
      this.hiddenDrivers = this.hiddenDrivers.filter(n => n !== num);
    } else {
      this.hiddenDrivers = [...this.hiddenDrivers, num];
    }
  }

  isHidden(num: number): boolean {
    return this.hiddenDrivers.includes(num);
  }

  reset() {
    this.hiddenDrivers = [];
  }

  hideAllExcept(allNums: number[], keepNums: number[]) {
    this.hiddenDrivers = allNums.filter(n => !keepNums.includes(n));
  }

  hideAll(allNums: number[]) {
    this.hiddenDrivers = [...allNums];
  }

  setLapRange(start: number, end: number) {
    this.lapRange = [start, end];
  }

  resetLapRange(maxLap: number) {
    this.lapRange = [1, maxLap];
  }

  addPin(pin: PinnedAnnotation) {
    if (this.pinnedAnnotations.some(p => p.id === pin.id)) return;
    this.pinnedAnnotations = [...this.pinnedAnnotations, pin];
  }

  removePin(id: string) {
    this.pinnedAnnotations = this.pinnedAnnotations.filter(p => p.id !== id);
  }

  clearPins() {
    this.pinnedAnnotations = [];
  }
}

export const chartState = new ChartState();
