(function () {
  'use strict';

  const fileInput = document.getElementById('file-input');
  const statusEl  = document.getElementById('status');
  const nameEl    = document.getElementById('file-name-display');

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    nameEl.textContent   = file.name;
    statusEl.textContent = 'Reading file…';

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      // Build base64 in chunks to avoid stack overflow on large files.
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }

      document.getElementById('hdn-content').value  = btoa(binary);
      document.getElementById('hdn-filename').value = file.name;
      document.getElementById('hdn-ext').value      = file.name.split('.').pop().toLowerCase();

      statusEl.textContent = 'Ready — click Import.';
    } catch (err) {
      statusEl.textContent = 'Read error: ' + err.message;
    }
  });
})();
