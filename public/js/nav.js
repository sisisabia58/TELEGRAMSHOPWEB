document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.nav-group').forEach((g) => {
    if (g.querySelector('.nav-item.active')) g.classList.add('open')
    const btn = g.querySelector('.nav-group-toggle')
    if (btn) btn.addEventListener('click', () => g.classList.toggle('open'))
  })
})
