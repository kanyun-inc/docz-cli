local M = {}

local state = {
  job = nil,
  seq = 0,
  current = nil,
  hash = nil,
  applying = false,
}

local function notify(msg, level)
  vim.notify(msg, level or vim.log.levels.INFO, { title = "docz.nvim" })
end

local function next_id()
  state.seq = state.seq + 1
  return state.seq
end

local function send(method, params)
  if not state.job then
    notify("bridge is not running", vim.log.levels.ERROR)
    return
  end
  local payload = vim.json.encode({ id = next_id(), method = method, params = params or {} })
  vim.fn.chansend(state.job, payload .. "\n")
end

local function set_buffer(content, hash)
  state.applying = true
  local lines = vim.split(content or "", "\n", { plain = true })
  if lines[#lines] == "" then
    table.remove(lines, #lines)
  end
  vim.api.nvim_buf_set_lines(0, 0, -1, false, lines)
  state.hash = hash
  state.applying = false
end

local function handle_message(msg)
  if msg.error then
    notify(msg.error, vim.log.levels.ERROR)
    return
  end

  if msg.event == "opened" or msg.event == "document_change" then
    set_buffer(msg.content or "", msg.hash)
    return
  end

  if msg.result and msg.result.hash then
    state.hash = msg.result.hash
  end

  if msg.result and msg.result.ref then
    notify("published " .. msg.result.path .. " @ " .. msg.result.ref)
  end
end

local function ensure_bridge()
  if state.job then
    return
  end

  state.job = vim.fn.jobstart({ "docz", "collab", "bridge" }, {
    stdin = "pipe",
    stdout_buffered = false,
    stderr_buffered = false,
    on_stdout = function(_, data)
      for _, line in ipairs(data or {}) do
        if line and line ~= "" then
          local ok, msg = pcall(vim.json.decode, line)
          if ok then
            vim.schedule(function()
              handle_message(msg)
            end)
          else
            notify("bad bridge json: " .. line, vim.log.levels.WARN)
          end
        end
      end
    end,
    on_stderr = function(_, data)
      for _, line in ipairs(data or {}) do
        if line and line ~= "" then
          notify(line, vim.log.levels.WARN)
        end
      end
    end,
    on_exit = function()
      state.job = nil
      state.current = nil
      state.hash = nil
      notify("bridge exited", vim.log.levels.WARN)
    end,
  })

  if state.job <= 0 then
    state.job = nil
    error("failed to start docz collab bridge")
  end
end

function M.open(target)
  ensure_bridge()
  state.current = target
  send("open", { target = target })

  vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI" }, {
    buffer = 0,
    group = vim.api.nvim_create_augroup("docz_collab_" .. vim.api.nvim_get_current_buf(), { clear = true }),
    callback = function()
      if state.applying or not state.current then
        return
      end
      local lines = vim.api.nvim_buf_get_lines(0, 0, -1, false)
      local content = table.concat(lines, "\n")
      send("local_change", { content = content, base_hash = state.hash })
    end,
  })
end

function M.publish()
  send("publish", {})
end

function M.status()
  send("status", {})
end

function M.close()
  if state.job then
    send("close", {})
    vim.fn.jobstop(state.job)
    state.job = nil
  end
  state.current = nil
  state.hash = nil
end

function M.setup()
  vim.api.nvim_create_user_command("DoczCollabOpen", function(opts)
    M.open(opts.args)
  end, { nargs = 1, complete = "file" })

  vim.api.nvim_create_user_command("DoczCollabPublish", function()
    M.publish()
  end, {})

  vim.api.nvim_create_user_command("DoczCollabStatus", function()
    M.status()
  end, {})

  vim.api.nvim_create_user_command("DoczCollabClose", function()
    M.close()
  end, {})
end

return M
