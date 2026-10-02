document.querySelectorAll('[data-type-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const fields = document.getElementById(button.getAttribute('aria-controls'));
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    fields.hidden = !expanded;
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? '{−}' : '{...}';
    button.setAttribute(
      'aria-label',
      button
        .getAttribute('aria-label')
        .replace(/Expand|Collapse/, expanded ? 'Collapse' : 'Expand'),
    );
  });
});

document.querySelectorAll('[data-copy-target]').forEach((button) => {
  button.addEventListener('click', async () => {
    const code = document.getElementById(button.dataset.copyTarget);
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = 'Copied';
      status.textContent = 'Commands copied.';
      setTimeout(() => {
        button.textContent = 'Copy';
      }, 2000);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Commands selected. Copy them using your keyboard.';
    }
  });
});
