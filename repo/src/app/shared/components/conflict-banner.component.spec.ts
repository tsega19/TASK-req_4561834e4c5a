import '../../../test-setup';
import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { ConflictBannerComponent } from './conflict-banner.component';
import { BroadcastService } from '../../core/services/broadcast.service';

@Component({
  standalone: true,
  imports: [ConflictBannerComponent],
  template: `<fc-conflict-banner (reload)="r = r + 1" (keep)="k = k + 1" />`
})
class HostComponent {
  r = 0;
  k = 0;
}

function mount() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

describe('ConflictBannerComponent', () => {
  it('is hidden until a conflict appears on the BroadcastService signal', () => {
    const fixture = mount();
    expect(fixture.nativeElement.querySelector('[data-testid="conflict-banner"]')).toBeNull();
  });

  it('renders with reload/keep buttons when a conflict is present', () => {
    const fixture = mount();
    const bc = TestBed.inject(BroadcastService);
    bc.conflict.set({ type: 'canvas-saved', canvasId: 'c', timestamp: 1, tabId: 'other' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="conflict-banner"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="conflict-reload"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="conflict-keep"]')).not.toBeNull();
  });

  it('emits reload / keep outputs when the user clicks the buttons', () => {
    const fixture = mount();
    const bc = TestBed.inject(BroadcastService);
    bc.conflict.set({ type: 'canvas-saved', canvasId: 'c', timestamp: 1, tabId: 'other' });
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="conflict-reload"]') as HTMLElement).click();
    (fixture.nativeElement.querySelector('[data-testid="conflict-keep"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.r).toBe(1);
    expect(fixture.componentInstance.k).toBe(1);
  });
});
