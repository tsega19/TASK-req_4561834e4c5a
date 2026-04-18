import '../../../test-setup';
import { TestBed } from '@angular/core/testing';
import { Component, ViewChild } from '@angular/core';
import { ModalComponent } from './modal.component';

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: `
    <fc-modal [title]="title" [dismissible]="dismissible" (backdropClose)="closed = closed + 1">
      <p data-testid="modal-child">body-content</p>
    </fc-modal>
  `
})
class HostComponent {
  title = 'My title';
  dismissible = true;
  closed = 0;
  @ViewChild(ModalComponent) modal!: ModalComponent;
}

function mount() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

describe('ModalComponent', () => {
  it('renders the title, labelled by titleId, and projects child content', () => {
    const fixture = mount();
    const el = fixture.nativeElement as HTMLElement;
    const heading = el.querySelector('h3')!;
    expect(heading.textContent).toContain('My title');
    const dialog = el.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(el.querySelector('[data-testid="modal-child"]')?.textContent).toContain('body-content');
  });

  it('emits backdropClose when the user clicks on the backdrop', () => {
    const fixture = mount();
    const backdrop = fixture.nativeElement.querySelector('[data-testid="modal-backdrop"]') as HTMLElement;
    backdrop.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.closed).toBe(1);
  });

  it('does NOT emit backdropClose when a click originates inside the dialog (event target test)', () => {
    const fixture = mount();
    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    dialog.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.closed).toBe(0);
  });

  it('does not emit when dismissible is false even on a direct backdrop click', () => {
    const fixture = mount();
    fixture.componentInstance.dismissible = false;
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="modal-backdrop"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.closed).toBe(0);
  });

  it('generates a titleId in the expected shape', () => {
    const fixture = mount();
    expect(fixture.componentInstance.modal.titleId).toMatch(/^modal-title-[a-z0-9]{1,6}$/);
  });
});
