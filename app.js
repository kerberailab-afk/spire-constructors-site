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
