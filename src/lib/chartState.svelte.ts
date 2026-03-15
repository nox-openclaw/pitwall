// Shared reactive state for chart interactivity across all chart components

class ChartState {
  hiddenDrivers = $state<number[]>([]);

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
}

export const chartState = new ChartState();
