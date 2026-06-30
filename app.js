// Mobile navigation: toggle the dropdown when the hamburger is tapped,
// and close it when a link is chosen or the user taps outside the menu.
document.addEventListener('click', function (e) {
  var links = document.querySelector('.nav-links');
  if (!links) return;
  if (e.target.closest('.menu-btn')) {
    links.classList.toggle('open');
    return;
  }
  if (links.classList.contains('open') &&
      (e.target.closest('.nav-links a') || !e.target.closest('.nav-links'))) {
    links.classList.remove('open');
  }
});

// Add a discreet "Crew Login" link to the footer Quick Links on every page.
document.addEventListener('DOMContentLoaded', function () {
  var target = null;
  document.querySelectorAll('footer .foot h4').forEach(function (h) {
    if (/quick links/i.test(h.textContent)) target = h.nextElementSibling;
  });
  if (!target) target = document.querySelector('footer .foot ul');
  if (target && !target.querySelector('a[href="scope.html"]')) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = 'scope.html';
    a.textContent = 'Team Login';
    li.appendChild(a);
    target.appendChild(li);
  }
});
