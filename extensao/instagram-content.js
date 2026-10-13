/* DOM-only interaction. No Instagram endpoints, credentials, cookies, or hidden APIs. */
(() => {
  'use strict';
  if (globalThis.__circuloContentScriptLoaded) return;
  globalThis.__circuloContentScriptLoaded = true;

  const ACTION_DELAY_MS = 5000;
  const MAX_SCAN_STEPS = 10000;
  const FOLLOWING = new Set(['seguindo', 'following']);
  const FOLLOW = new Set(['seguir', 'follow', 'seguir de volta', 'follow back']);
  const UNFOLLOW = new Set(['deixar de seguir', 'unfollow']);
  const CANCEL = new Set(['cancelar', 'cancel']);
  const RESERVED = new Set(['accounts', 'about', 'direct', 'explore', 'reels', 'stories', 'p', 'reel', 'challenge', 'checkpoint', 'legal', 'privacy', 'terms']);
  let runner = null;

  class Halt extends Error {}
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const label = element => normalize(element?.innerText || element?.textContent || element?.getAttribute('aria-label'));
  const buttons = scope => Array.from(scope.querySelectorAll('button,[role="button"]'));
  const isVisible = element => {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };

  function usernameOf(anchor) {
    try {
      const url = new URL(anchor.getAttribute('href'), location.origin);
      const match = url.pathname.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
      return url.origin === location.origin && match && !RESERVED.has(match[1].toLowerCase()) ? match[1].toLowerCase() : null;
    } catch { return null; }
  }

  function pageOwner() {
    const match = location.pathname.match(/^\/([a-zA-Z0-9._]{1,30})(?:\/following)?\/?$/);
    if (!match || RESERVED.has(match[1].toLowerCase())) return null;
    const editing = buttons(document).concat(Array.from(document.querySelectorAll('a'))).some(element =>
      isVisible(element) && ['editar perfil', 'edit profile'].includes(label(element))
    );
    return editing ? match[1].toLowerCase() : null;
  }

  function blockingReason() {
    if (/\/(?:challenge|checkpoint)(?:\/|$)|\/accounts\/(?:login|suspended)(?:\/|$)/i.test(location.pathname)) {
      return 'O Instagram solicitou login ou uma verificação. Resolva isso manualmente antes de continuar.';
    }
    const surfaces = Array.from(document.querySelectorAll('[role="alert"],[role="dialog"]')).filter(isVisible);
    const text = normalize(surfaces.map(surface => surface.innerText || surface.textContent).join(' '));
    const blocked = [
      'try again later', 'tente novamente mais tarde', 'action blocked', 'acao bloqueada',
      'we restrict certain activity', 'restringimos determinadas atividades', 'restringimos certas atividades',
      'feedback_required', 'temporarily blocked', 'temporariamente bloquead', 'you are going too fast',
      'voce esta indo rapido demais', 'confirm your identity', 'confirme sua identidade',
      'suspicious activity', 'atividade suspeita'
    ];
    return blocked.some(phrase => text.includes(phrase))
      ? 'O Instagram exibiu uma restrição ou verificação. Execução interrompida; confira a conta manualmente.' : null;
  }

  function listDialog(owner) {
    const candidates = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible).filter(dialog => {
      const localButtons = buttons(dialog).filter(button => button.closest('[role="dialog"]') === dialog);
      if (localButtons.some(button => UNFOLLOW.has(label(button)) && isVisible(button))) return false;
      const headings = Array.from(dialog.querySelectorAll('h1,h2,h3,[role="heading"],span,div')).filter(element =>
        !element.closest('button,[role="button"]') && (element.children.length === 0 || /^H[123]$/.test(element.tagName))
      );
      return headings.some(element => FOLLOWING.has(label(element)) && isVisible(element));
    });
    return candidates.length === 1 ? candidates[0] : null;
  }

  function unexpectedDialog(list, allowedUsername) {
    const allowed = allowedUsername && confirmDialog(allowedUsername)?.dialog;
    return Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible).some(dialog =>
      dialog !== list && !dialog.contains(list) && dialog !== allowed
    );
  }

  function inspect() {
    const block = blockingReason();
    const owner = pageOwner();
    const dialog = owner && listDialog(owner);
    const extraDialog = dialog && unexpectedDialog(dialog, runner?.active ? runner.current : null);
    return {
      ready: !block && !extraDialog && Boolean(owner && dialog), owner,
      reason: block || (!owner
        ? 'Abra seu próprio perfil do Instagram. O botão Editar perfil deve estar visível atrás da lista.'
        : !dialog ? 'Abra Seguindo no seu próprio perfil e mantenha essa lista aberta.'
          : extraDialog ? 'Feche o diálogo extra do Instagram e deixe apenas a lista Seguindo aberta antes de continuar.' : ''),
      runner: runner ? { active: runner.active, runId: runner.runId, state: runner.desired } : null
    };
  }

  async function send(token, type, extra = {}) {
    try { return await chrome.runtime.sendMessage({ type, runId: token.runId, ...extra }); }
    catch { token.desired = 'paused'; throw new Halt('A extensão perdeu a conexão. Confira a aba antes de retomar.'); }
  }

  async function gate(token) {
    if (token.desired !== 'running') throw new Halt('');
    const response = await send(token, 'CIRCULO_CHECK_CONTROL');
    if (!response?.allowed) { token.desired = response?.state || 'paused'; throw new Halt(''); }
    const info = inspect();
    if (!info.ready || info.owner !== token.owner) throw new Halt(info.reason || 'A lista Seguindo mudou. Confira o próprio perfil antes de retomar.');
    return listDialog(token.owner);
  }

  async function wait(ms, token, interruptible = true) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (interruptible && token.desired !== 'running') throw new Halt('');
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(1, end - Date.now()))));
    }
  }

  function scrollContainer(dialog) {
    const candidates = [dialog, ...dialog.querySelectorAll('div,ul,section')].filter(element => {
      const style = getComputedStyle(element);
      return isVisible(element) && /(auto|scroll)/.test(style.overflowY) && element.clientHeight > 80 && element.scrollHeight > element.clientHeight + 5;
    });
    candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
    return candidates[0] || null;
  }

  function inView(element, scroller) {
    if (!isVisible(element)) return false;
    const rect = element.getBoundingClientRect();
    const bounds = scroller?.getBoundingClientRect() || { top: 0, left: 0, right: innerWidth, bottom: innerHeight };
    return rect.top >= Math.max(0, bounds.top) && rect.bottom <= Math.min(innerHeight, bounds.bottom) &&
      rect.left >= Math.max(0, bounds.left) && rect.right <= Math.min(innerWidth, bounds.right);
  }

  function rows(dialog, scroller) {
    const found = [];
    for (const button of buttons(dialog)) {
      if (!FOLLOWING.has(label(button)) || !inView(button, scroller) || button.disabled || button.getAttribute('aria-disabled') === 'true') continue;
      let node = button.parentElement;
      while (node && node !== dialog) {
        const links = Array.from(node.querySelectorAll('a[href]'));
        const names = [...new Set(links.map(usernameOf).filter(Boolean))];
        if (names.length === 1) {
          const sameButtons = buttons(node).filter(candidate => FOLLOWING.has(label(candidate)) && isVisible(candidate));
          if (sameButtons.length === 1 && sameButtons[0] === button) found.push({ username: names[0], button, element: node });
          break;
        }
        if (names.length > 1) break;
        node = node.parentElement;
      }
    }
    return found;
  }

  function confirmDialog(username) {
    const pattern = new RegExp(`(^|[^a-z0-9._])@?${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9._])`, 'i');
    const matches = Array.from(document.querySelectorAll('[role="dialog"]')).filter(isVisible).map(dialog => {
      const confirm = buttons(dialog).filter(button => UNFOLLOW.has(label(button)) && isVisible(button));
      const identity = `${dialog.innerText || dialog.textContent || ''} ${Array.from(dialog.querySelectorAll('img')).map(image => image.alt).join(' ')}`;
      const identifies = pattern.test(identity) || Array.from(dialog.querySelectorAll('a[href]')).some(anchor => usernameOf(anchor) === username);
      return confirm.length === 1 && identifies ? { dialog, button: confirm[0] } : null;
    }).filter(Boolean);
    return matches.length === 1 ? matches[0] : null;
  }

  function outcome(token, row, list) {
    const block = blockingReason();
    if (block) return { blocked: block };
    if (!list.isConnected || pageOwner() !== token.owner || !listDialog(token.owner)) return null;
    if (confirmDialog(row.username)) return null;
    if (row.button.isConnected && FOLLOW.has(label(row.button))) return { completed: true };
    if (row.element.isConnected && buttons(row.element).some(button => FOLLOW.has(label(button)) && isVisible(button))) return { completed: true };
    // Removal can also mean virtualization, so it is never proof of an unfollow.
    return null;
  }

  async function result(token, username, outcomeName, reason, pause = false) {
    const response = await send(token, 'CIRCULO_ITEM_RESULT', { username, outcome: outcomeName, reason, pause });
    if (!response?.accepted) throw new Halt('O resultado não pôde ser registrado. Confira a conta manualmente.');
    token.remaining.delete(username);
    if (pause) { token.desired = 'paused'; throw new Halt(''); }
  }

  async function cancelOpened(token, row, list) {
    const confirmation = confirmDialog(row.username);
    if (confirmation) {
      const cancel = buttons(confirmation.dialog).find(button => CANCEL.has(label(button)) && isVisible(button));
      if (cancel) {
        cancel.click();
        await wait(350, token, false);
        if (!confirmDialog(row.username) && row.button.isConnected && FOLLOWING.has(label(row.button))) {
          await send(token, 'CIRCULO_ITEM_CANCEL', { username: row.username });
          return;
        }
      }
    }
    const verified = outcome(token, row, list);
    if (verified?.completed) { await result(token, row.username, 'completed'); return; }
    await result(token, row.username, 'skipped', 'A execução foi interrompida durante esta ação. Resultado não confirmado; revise a conta manualmente.');
  }

  async function processRow(token, row, list) {
    let armed = false;
    let confirmed = false;
    token.current = row.username;
    try {
      await gate(token);
      const followsYou = Array.from(row.element.querySelectorAll('span,div')).some(element => element.children.length === 0 && ['segue voce', 'follows you'].includes(label(element)));
      if (followsYou) {
        await result(token, row.username, 'skipped', 'O Instagram indica que esta conta segue você. Conexão mantida.');
        return;
      }
      const begun = await send(token, 'CIRCULO_ITEM_BEGIN', { username: row.username });
      if (!begun?.allowed) throw new Halt('');
      if (begun.waitMs) await wait(begun.waitMs, token);
      await gate(token);
      // Persist uncertainty before the first click; a changed Instagram UI may act immediately.
      const permit = await send(token, 'CIRCULO_ITEM_ARM', { username: row.username });
      if (!permit?.allowed || token.desired !== 'running') throw new Halt('');
      armed = true;
      const fresh = rows(list, scrollContainer(list)).filter(candidate => candidate.username === row.username);
      if (fresh.length !== 1 || fresh[0].button !== row.button) {
        await send(token, 'CIRCULO_ITEM_CANCEL', { username: row.username });
        throw new Halt('A linha mudou antes do clique. Confira a lista e retome.');
      }
      row.button.click();
      let confirmation = null;
      const dialogDeadline = Date.now() + 5000;
      while (Date.now() < dialogDeadline) {
        await wait(150, token);
        const block = blockingReason();
        if (block) throw new Halt(block);
        confirmation = confirmDialog(row.username);
        if (confirmation) break;
        if (outcome(token, row, list)?.completed) {
          await result(token, row.username, 'completed');
          return;
        }
      }
      if (!confirmation) {
        await result(token, row.username, 'skipped', 'A confirmação esperada não apareceu. Resultado não confirmado; revise a conta manualmente.', true);
      }
      await gate(token);
      const permitConfirm = await send(token, 'CIRCULO_CHECK_CONTROL');
      confirmation = confirmDialog(row.username);
      if (!permitConfirm?.allowed || token.desired !== 'running' || !confirmation || confirmation.button.disabled) throw new Halt('');
      confirmed = true;
      confirmation.button.click();
      // Once confirmed, verify the in-flight result even if Pause/Stop is pressed.
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        await wait(200, token, false);
        const verified = outcome(token, row, list);
        if (verified?.blocked) {
          await result(token, row.username, 'skipped', verified.blocked, true);
        }
        if (verified?.completed) {
          await result(token, row.username, 'completed');
          return;
        }
      }
      await result(token, row.username, 'skipped', 'O Instagram não confirmou o resultado. Esta conta não será tentada novamente nesta execução; revise manualmente.', true);
    } catch (error) {
      if (armed && !confirmed && token.remaining.has(row.username)) await cancelOpened(token, row, list).catch(() => {});
      throw error;
    } finally {
      token.current = null;
    }
  }

  async function run(token) {
    try {
      let list = await gate(token);
      let scroller = scrollContainer(list);
      if (scroller) { scroller.scrollTop = 0; await wait(500, token); }
      let endRounds = 0;
      let oldSignature = '';
      let reachedEnd = false;
      for (let step = 0; step < MAX_SCAN_STEPS && token.remaining.size; step++) {
        list = await gate(token);
        scroller = scrollContainer(list);
        const visibleRows = rows(list, scroller);
        const selected = visibleRows.filter(row => token.remaining.has(row.username));
        if (selected.length) {
          await processRow(token, selected[0], list);
          await wait(ACTION_DELAY_MS, token);
          endRounds = 0;
          continue;
        }
        const signature = visibleRows.map(row => row.username).join('|');
        if (!scroller) {
          endRounds = signature === oldSignature ? endRounds + 1 : 0;
          oldSignature = signature;
          if (endRounds >= 4) { reachedEnd = true; break; }
          await wait(700, token);
          continue;
        }
        const before = scroller.scrollTop;
        const atEnd = before + scroller.clientHeight >= scroller.scrollHeight - 4;
        if (atEnd && signature === oldSignature) endRounds++;
        else endRounds = 0;
        oldSignature = signature;
        if (endRounds >= 4) { reachedEnd = true; break; }
        scroller.scrollTop = Math.min(scroller.scrollHeight, before + Math.max(80, Math.floor(scroller.clientHeight * 0.7)));
        await wait(atEnd ? 900 : 400, token);
      }
      if (token.remaining.size && !reachedEnd) throw new Halt('A lista atingiu o limite de leitura desta execução. Confira os resultados e retome para revisar o restante.');
      for (const username of [...token.remaining]) {
        await gate(token);
        await result(token, username, 'skipped', 'Não localizado na lista Seguindo aberta. A lista pode estar incompleta ou ter mudado; confira manualmente.');
      }
      await send(token, 'CIRCULO_WORKER_DONE');
    } catch (error) {
      token.desired = token.desired === 'stopped' ? 'stopped' : 'paused';
      await send(token, 'CIRCULO_WORKER_HALTED', {
        reason: error instanceof Halt ? error.message : 'A estrutura da página mudou. Execução pausada; confira a lista antes de retomar.'
      }).catch(() => {});
    } finally {
      token.active = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type === 'CIRCULO_INSPECT') { sendResponse(inspect()); return false; }
    if (message?.type === 'CIRCULO_WORKER_CONTROL') {
      if (runner?.runId === message.runId && ['paused', 'stopped'].includes(message.state)) runner.desired = message.state;
      sendResponse({ accepted: true });
      return false;
    }
    if (message?.type === 'CIRCULO_WORKER_RUN') {
      const info = inspect();
      if (!info.ready || info.owner !== message.owner || !Array.isArray(message.usernames)) {
        sendResponse({ accepted: false, reason: info.reason || 'A conta aberta não corresponde à execução.' });
        return false;
      }
      if (runner?.active) {
        if (runner.runId === message.runId && runner.desired !== 'stopped') {
          runner.desired = 'running';
          sendResponse({ accepted: true });
        } else sendResponse({ accepted: false, reason: 'Aguarde a ação anterior terminar.' });
        return false;
      }
      runner = { runId: message.runId, owner: message.owner, remaining: new Set(message.usernames), desired: 'running', active: true };
      sendResponse({ accepted: true });
      void run(runner);
      return false;
    }
    return false;
  });
})();
