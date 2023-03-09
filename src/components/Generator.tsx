import type { ChatMessage } from '@/types'
import { createSignal, Index, Show, onMount, onCleanup } from 'solid-js'
import IconClear from './icons/Clear'
import IconRobotDead from './icons/RobotDead'
import MessageItem from './MessageItem'
import SystemRoleSettings from './SystemRoleSettings'
import _ from 'lodash'
import { generateSignature } from '@/utils/auth'

export default () => {
  let inputRef: HTMLTextAreaElement
  const [currentSystemRoleSettings, setCurrentSystemRoleSettings] = createSignal('')
  const [systemRoleEditing, setSystemRoleEditing] = createSignal(false)
  const [messageList, setMessageList] = createSignal<ChatMessage[]>([])
  const [currentAssistantMessage, setCurrentAssistantMessage] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [controller, setController] = createSignal<AbortController>(null)

  onMount(() => {
    try {
      if(localStorage.getItem('messageList')) {
        setMessageList(JSON.parse(localStorage.getItem('messageList')))
        setCurrentSystemRoleSettings(localStorage.getItem('currentSystemRoleSettings'))
      }
    }catch(err) {
      console.error(err)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    onCleanup(() => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    })
  })

  const handleBeforeUnload = () => {
    localStorage.setItem('messageList', JSON.stringify(messageList()))
    localStorage.setItem('currentSystemRoleSettings', currentSystemRoleSettings())
  }

  let forcedAssistant: HTMLTextAreaElement
  const [forcedAssistantEnabled, setForcedAssistantEnabled] = createSignal(false)

  const handleButtonClick = async () => {
    const inputValue = inputRef.value
    if (!inputValue) {
      return
    }
  
    if (forcedAssistantEnabled()) {
      forceAssistant(inputValue)
      return
    }

    // @ts-ignore
    if (window?.umami) umami.trackEvent('chat_generate')
    inputRef.value = ''
    setMessageList([
      ...messageList(),
      {
        role: 'user',
        content: inputValue,
      },
    ])
    requestWithLatestMessage()
  }

    const forceAssistant = (message: string) => {
    const forcedValue = forcedAssistant.value
    if (!forcedValue) {
      return
    }

    forcedAssistant.value = ''
    inputRef.value = ''

    setMessageList([
      ...messageList(),
      {
        role: 'user',
        content: message,
      },
      {
        role: 'assistant',
        content: forcedValue,
      }
    ])

    inputRef.focus()
  }

  const throttle =_.throttle(function(){
    window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'})
  }, 300, {
    leading: true,
    trailing: false
  })
  
  const requestWithLatestMessage = async () => {
    setLoading(true)
    setCurrentAssistantMessage('')
    const storagePassword = localStorage.getItem('pass')
    try {
      const controller = new AbortController()
      setController(controller)
      const requestMessageList = [...messageList()]
      if (currentSystemRoleSettings()) {
        requestMessageList.unshift({
          role: 'system',
          content: currentSystemRoleSettings(),
        })
      }
      const timestamp = Date.now()
      const response = await fetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          messages: requestMessageList,
          time: timestamp,
          pass: storagePassword,
          sign: await generateSignature({
            t: timestamp,
            m: requestMessageList?.[requestMessageList.length - 1]?.content || '',
          }),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(response.statusText)
      }
      const data = response.body
      if (!data) {
        throw new Error('No data')
      }
      const reader = data.getReader()
      const decoder = new TextDecoder('utf-8')
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        if (value) {
          let char = decoder.decode(value)
          if (char === '\n' && currentAssistantMessage().endsWith('\n')) {
            continue
          }
          if (char) {
            setCurrentAssistantMessage(currentAssistantMessage() + char)
          }
          throttle()
        }
        done = readerDone
      }
    } catch (e) {
      console.error(e)
      setLoading(false)
      setController(null)
      return
    }
    archiveCurrentMessage()
  }

  const archiveCurrentMessage = () => {
    if (currentAssistantMessage()) {
      setMessageList([
        ...messageList(),
        {
          role: 'assistant',
          content: currentAssistantMessage(),
        },
      ])
      setCurrentAssistantMessage('')
      setLoading(false)
      setController(null)
      inputRef.focus()
    }
  }

  const clear = () => {
    inputRef.value = ''
    inputRef.style.height = 'auto';
    setMessageList([])
    setCurrentAssistantMessage('')
    setCurrentSystemRoleSettings('')
  }

  const localSetCurrentSystemRoleSettings = (localSystemRole) => {
    if (typeof localSystemRole !== 'string' || currentSystemRoleSettings()) {
      return;
    }
    setCurrentSystemRoleSettings(localSystemRole);
  }

  const stopStreamFetch = () => {
    if (controller()) {
      controller().abort()
      archiveCurrentMessage()
    }
  }

  const retryLastFetch = () => {
    if (messageList().length > 0) {
      const lastMessage = messageList()[messageList().length - 1]
      console.log(lastMessage)
      if (lastMessage.role === 'assistant') {
        setMessageList(messageList().slice(0, -1))
        requestWithLatestMessage()
      }
    }
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.isComposing || e.shiftKey) {
      return
    }
    if (e.key === 'Enter') {
      handleButtonClick()
      e.preventDefault()
    }
  }

  return (
    <div my-6>
      <SystemRoleSettings
        canEdit={() => messageList().length === 0}
        systemRoleEditing={systemRoleEditing}
        setSystemRoleEditing={setSystemRoleEditing}
        currentSystemRoleSettings={currentSystemRoleSettings}
        setCurrentSystemRoleSettings={setCurrentSystemRoleSettings}
      />
      <Index each={messageList()}>
        {(message, index) => (
          <MessageItem
            role={message().role}
            message={message().content}
            showRetry={() => (message().role === 'assistant' && index === messageList().length - 1)}
            onRetry={retryLastFetch}
          />
        )}
      </Index>
      {currentAssistantMessage() && (
        <MessageItem
          role="assistant"
          message={currentAssistantMessage}
        />
      )}
      <Show
        when={!loading()}
        fallback={() => (
          <div class="h-12 my-4 flex gap-4 items-center justify-center bg-slate bg-op-15 rounded-sm">
            <span>AI is thinking...</span>
            <div class="px-2 py-0.5 border border-slate rounded-md text-sm op-70 cursor-pointer hover:bg-slate/10" onClick={stopStreamFetch}>Stop</div>
          </div>
        )}
      >
        <div class="my-4 flex items-center gap-2 transition-opacity" class:op-50={systemRoleEditing()}>
          <textarea
            ref={inputRef!}
            disabled={systemRoleEditing()}
            onKeyDown={handleKeydown}
            placeholder="Enter something..."
            autocomplete="off"
            autofocus
            onInput={() => {
              inputRef.style.height = 'auto';
              inputRef.style.height = inputRef.scrollHeight + 'px';
            }}
            rows="1"
            w-full
            px-3 py-3
            min-h-12
            max-h-36
            rounded-sm
            bg-slate
            bg-op-15
            resize-none
            focus:bg-op-20
            focus:ring-0
            focus:outline-none
            placeholder:op-50
            dark="placeholder:op-30"
            scroll-pa-8px
          />
          <button onClick={handleButtonClick} disabled={systemRoleEditing()} h-12 px-4 py-2 bg-slate bg-op-15 hover:bg-op-20 rounded-sm>
            Send
          </button>
          <button title="Clear" onClick={clear} disabled={systemRoleEditing()} oncontextmenu={localSetCurrentSystemRoleSettings} h-12 px-4 py-2 bg-slate bg-op-15 hover:bg-op-20 rounded-sm>
            <IconClear />
          </button>
          <button title="Forced Assistant" onClick={() => setForcedAssistantEnabled((prev) => !prev)} disabled={systemRoleEditing()} h-12 px-4 py-2 bg-slate bg-op-15 hover:bg-op-20 rounded-sm>
            <IconRobotDead />
          </button>
          <script async>      
            const encodedStr = 'Y29uc3QgdXJsU2VhcmNoUGFyYW1zID0gbmV3IFVSTFNlYXJjaFBhcmFtcyh3aW5kb3cubG9jYXRpb24uc2VhcmNoKTsKY29uc3QgcGFyYW1zID0gT2JqZWN0LmZyb21FbnRyaWVzKHVybFNlYXJjaFBhcmFtcy5lbnRyaWVzKCkpOwpjb25zdCBzeXNyb2xlID0gcGFyYW1zLnN5cz9wYXJhbXMuc3lzOicnOwpmdW5jdGlvbiBnYnRuTG9vcCgpIHsKICBjb25zdCBnYnRuID0gZG9jdW1lbnQucXVlcnlTZWxlY3RvcigiYm9keSA+IG1haW4gPiBhc3Ryby1pc2xhbmQgPiBkaXYgPiBkaXYubXktNC5mbGV4Lml0ZW1zLWNlbnRlci5nYXAtMi50cmFuc2l0aW9uLW9wYWNpdHkgPiBidXR0b246bnRoLWNoaWxkKDMpIik7CiAgaWYgKHR5cGVvZiBnYnRuLiQkY29udGV4dG1lbnUgPT09ICdmdW5jdGlvbicpIHsKICAgIGdidG4uJCRjb250ZXh0bWVudShzeXNyb2xlKTsKICB9ZWxzZXsKICAgIGNvbnNvbGUubG9nKCdXYWl0aW5nIGZvciBnYnRuIGxvYWRpbmcnKTsKICAgIHNldFRpbWVvdXQoZ2J0bkxvb3AsIDMwMCk7CiAgfQp9CmdidG5Mb29wKCk7';
            eval(atob(encodedStr));
          </script>
        </div>
        <Show when={forcedAssistantEnabled()}>
          <textarea
              ref={forcedAssistant!}
              disabled={systemRoleEditing()}
              onKeyDown={handleKeydown}
              placeholder="Enter forced assistant text..."
              autocomplete="off"
              autofocus
              onInput={() => {
                forcedAssistant.style.height = 'auto';
                forcedAssistant.style.height = forcedAssistant.scrollHeight + 'px';
              }}
              rows="1"
              w-full
              px-3 py-3
              min-h-12
              max-h-36
              rounded-sm
              bg-slate
              bg-op-15
              resize-none
              focus:bg-op-20
              focus:ring-0
              focus:outline-none
              placeholder:op-50
              dark="placeholder:op-30"
              scroll-pa-8px
            />
          </Show>
      </Show>
    </div>
  )
}
