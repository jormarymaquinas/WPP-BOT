import * as WPP from '@wppconnect/wa-js';
import type { Message } from './types/Message';
import asyncQueue from './utils/AsyncEventQueue';
import AsyncChromeMessageManager from './utils/AsyncChromeMessageManager';
import storageManager, { AsyncStorageManager } from './utils/AsyncStorageManager';
import { ChromeMessageTypes } from './types/ChromeMessageTypes';

const WebpageMessageManager = new AsyncChromeMessageManager('webpage');

async function sendWPPMessage({ contact, message, attachment, buttons = [] }: Message) {

    if (attachment && buttons.length > 0) {
        const response = await fetch(attachment.url.toString());
        const data = await response.blob();
        return await WPP.chat.sendFileMessage(
            contact,
            new File([data], attachment.name, {
                type: attachment.type,
                lastModified: attachment.lastModified,
            }),
            {
                type: 'image',
                caption: message,
                createChat: true,
                waitForAck: true,
                buttons
            }
        );
    } else if (buttons.length > 0) {
        return await WPP.chat.sendTextMessage(contact, message, {
            createChat: true,
            waitForAck: true,
            buttons
        });
    } else if (attachment) {
        const response = await fetch(attachment.url.toString());
        const data = await response.blob();
        return await WPP.chat.sendFileMessage(
            contact,
            new File([data], attachment.name, {
                type: attachment.type,
                lastModified: attachment.lastModified,
            }),
            {
                type: 'auto-detect',
                caption: message,
                createChat: true
            }
        );
    } else {
        return await WPP.chat.sendTextMessage(contact, message, {
            createChat: true
        });
    }
}

async function sendMessage({ contact, hash }: { contact: string, hash: number }) {
    if (!WPP.conn.isAuthenticated()) {
        const errorMsg = 'Conecte-se primeiro!';
        alert(errorMsg);
        throw new Error(errorMsg);
    }
    const { message } = await storageManager.retrieveMessage(hash);

    const resultAux = await WPP.contact.queryExists(contact);
    if (resultAux && resultAux.wid) {
        contact = resultAux.wid.user;
    } else {
        WebpageMessageManager.sendMessage(ChromeMessageTypes.ADD_LOG, { level: 1, message: "Contato não encontrado", attachment: message.attachment != null, contact: contact });
        return;
    }

    /*
    //const ProfileName = await WPP.contact.get(contact);
    // const notifyName = ProfileName?.notifyName || '';

    //Get user model
    const GetContact = await WPP.contact.get(contact);
    let notifyName = '';

    if (GetContact) {
        //Get Profile name submitted from user
        notifyName = WPP.whatsapp.functions.getNotifyName(GetContact) || '';
    }
    // Replace from message in placeholder (%s)
    message.message = replacePlaceholder(message.message, notifyName);
    */
    const result = await sendWPPMessage({ contact, ...message });
    return result.sendMsgResult.then(value => {
        const result = (value as any).messageSendResult ?? value;
        if (result !== WPP.whatsapp.enums.SendMsgResult.OK) {
            throw new Error('Falha ao enviar a mensagem: ' + value);
        } else {
            WebpageMessageManager.sendMessage(ChromeMessageTypes.ADD_LOG, { level: 3, message: 'Mensagem enviada com sucesso!', attachment: message.attachment != null, contact: contact });
        }
    });
}

async function addToQueue(message: Message) {
    try {
        const messageHash = AsyncStorageManager.calculateMessageHash(message);
        await storageManager.storeMessage(message, messageHash);
        await asyncQueue.add({ eventHandler: sendMessage, detail: { contact: message.contact, hash: messageHash, delay: message.delay } });
        return true;
    } catch (error) {
        if (error instanceof Error) {
            WebpageMessageManager.sendMessage(ChromeMessageTypes.ADD_LOG, { level: 1, message: error.message, attachment: message.attachment != null, contact: message.contact });
        }
        throw error;
    }
}

WebpageMessageManager.addHandler(ChromeMessageTypes.PAUSE_QUEUE, async () => {
    await asyncQueue.pause();
    return true;
});

WebpageMessageManager.addHandler(ChromeMessageTypes.RESUME_QUEUE, async () => {
    await asyncQueue.resume();
    return true;
});

WebpageMessageManager.addHandler(ChromeMessageTypes.STOP_QUEUE, async () => {
    await asyncQueue.stop();
    return true;
});

WebpageMessageManager.addHandler(ChromeMessageTypes.SEND_MESSAGE, async (message) => {
    if (WPP.webpack.isReady) {
        return await addToQueue(message);
    } else {
        return new Promise((resolve, reject) => {
            WPP.webpack.onReady(async () => {
                try {
                    resolve(await addToQueue(message));
                } catch (error) {
                    reject(error);
                }
            });
        });
    }
});

WebpageMessageManager.addHandler(ChromeMessageTypes.QUEUE_STATUS, async () => {
    return await asyncQueue.getStatus();
});

storageManager.clearDatabase();

WPP.webpack.injectLoader();

function replacePlaceholder(message: string, replacement: string): string {

    const nameParts = replacement.split(' ');
    replacement = nameParts[0];

    // Check if the message contains at least one "%s" placeholder
    if (message.indexOf('%s') === -1) {
        // If no placeholder is found, no replacement is needed
        message = message;
    }
    // Check if replacement is an empty string
    if (replacement === '') {
        message = message.replace(' %s', '');
    }
    else {
        message = message.replace('%s', replacement.trim());
    }

    return message;
}