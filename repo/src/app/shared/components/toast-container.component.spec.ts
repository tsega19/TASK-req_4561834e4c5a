import '../../../test-setup';
import { TestBed } from '@angular/core/testing';
import { ToastContainerComponent } from './toast-container.component';
import { NotificationService } from '../../core/services/notification.service';

function mount() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [ToastContainerComponent] });
  const fixture = TestBed.createComponent(ToastContainerComponent);
  const notif = TestBed.inject(NotificationService);
  fixture.detectChanges();
  return { fixture, notif };
}

describe('ToastContainerComponent', () => {
  afterEach(() => jest.useRealTimers());

  it('renders a toast per notification with kind-specific data-testid', () => {
    jest.useFakeTimers();
    const { fixture, notif } = mount();
    notif.error('nope');
    notif.success('yay');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="toast-error"]')?.textContent).toContain('nope');
    expect(el.querySelector('[data-testid="toast-success"]')?.textContent).toContain('yay');
  });

  it('clicking a toast dismisses it', () => {
    jest.useFakeTimers();
    const { fixture, notif } = mount();
    notif.info('click me');
    fixture.detectChanges();
    const toast = fixture.nativeElement.querySelector('[data-testid="toast-info"]') as HTMLElement;
    toast.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="toast-info"]')).toBeNull();
  });

  it('is aria-live=polite for assistive tech', () => {
    mount();
    const container = document.querySelector('.toast-container') as HTMLElement | null;
    expect(container?.getAttribute('aria-live')).toBe('polite');
  });
});
