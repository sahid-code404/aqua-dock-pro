import { trashDir } from '../services/fileService.js';

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

assert(trashDir().get_uri() === 'trash:///',
    'Trash state and Empty Trash must use the desktop GIO Trash backend');

print('fileService: ok');
