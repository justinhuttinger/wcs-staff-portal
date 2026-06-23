'use strict'

function renderSuccessPage(contactId) {
  const cid = encodeURIComponent(contactId || '')
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Generating Program...</title>
  <style>
    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; color: #222; }
    h1 { color: #E31E24; }
    #steps { margin-top: 20px; font-size: 16px; color: #555; min-height: 24px; }
    a { color: #E31E24; font-weight: bold; }
  </style>
</head>
<body>
  <h1>Generating Program...</h1>
  <p>Your personalized training program is being created. This usually takes 10 to 15 seconds.</p>
  <div id="steps">Starting...</div>
  <script>
    var stepsEl = document.getElementById('steps');
    var es = new EventSource('/day-one-program/status/stream?contactId=${cid}');
    es.addEventListener('progress', function (e) {
      try { var d = JSON.parse(e.data); stepsEl.textContent = d.progress || d.status || ''; } catch (_) {}
    });
    es.addEventListener('done', function (e) {
      try {
        var d = JSON.parse(e.data);
        es.close();
        if (d.jobId) {
          stepsEl.innerHTML = 'Program ready. Opening your PDF...';
          window.location.href = '/day-one-program/pdf/' + d.jobId;
        } else {
          stepsEl.textContent = 'Program sent. Check the client email.';
        }
      } catch (_) {}
    });
    es.addEventListener('failed', function (e) {
      es.close();
      stepsEl.innerHTML = 'Your program is still being sent. Please check the client email shortly.';
    });
    es.onerror = function () { /* keep the page; SSE auto-reconnects */ };
  </script>
</body>
</html>`
}

module.exports = { renderSuccessPage }
