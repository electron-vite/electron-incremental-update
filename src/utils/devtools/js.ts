/* eslint-disable unused-imports/no-unused-vars */
// Reference from https://github.com/electron/electron/issues/42055#issuecomment-2449365647
function run(css: string): void {
  let overriddenStyle = document.createElement('style')
  overriddenStyle.innerHTML = css
  document.body.append(overriddenStyle)
  ;['platform-windows', 'platform-mac', 'platform-linux'].forEach((c) =>
    document.querySelectorAll(`.${c}`).forEach((el) => el.classList.remove(c)),
  )

  addStyleToAutoComplete()

  const observer = new MutationObserver((mutationList) => {
    for (const mutation of mutationList) {
      if (mutation.type === 'childList') {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const item = mutation.addedNodes[i] as Element
          if (item.classList.contains('editor-tooltip-host')) {
            addStyleToAutoComplete()
          }
        }
      }
    }
  })
  observer.observe(document.body, { childList: true })
  function addStyleToAutoComplete(): void {
    document.querySelectorAll('.editor-tooltip-host').forEach((element) => {
      if (
        element?.shadowRoot?.querySelectorAll('[data-key="overridden-dev-tools-font"]').length === 0
      ) {
        const overriddenStyle = document.createElement('style')
        overriddenStyle.dataset.key = 'overridden-dev-tools-font'
        overriddenStyle.innerHTML = `${css}.cm-tooltip-autocomplete ul[role=listbox]{font-family:var(--mono)!important;}`
        element.shadowRoot.append(overriddenStyle)
      }
    })
  }

  // Cleanup
  window.onbeforeunload = () => observer.disconnect()
}

declare const __CSS__: string
run(__CSS__)
