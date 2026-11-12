#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

typedef void (*PoketoneFileChoice)(const char *);

// SDL exposes the pointer to its NSView in a Buffer. Sheets keep the app event loop running.
void *poketone_choose_file(const void *viewHandle, bool save, PoketoneFileChoice completed) {
  @autoreleasepool {
    NSView *view = (__bridge NSView *)(*(void *const *)viewHandle);
    if (view.window == nil) return NULL;
    NSSavePanel *panel = save ? [NSSavePanel savePanel] : [NSOpenPanel openPanel];
    panel.allowedContentTypes = @[[UTType typeWithFilenameExtension:@"txt"]];
    panel.canCreateDirectories = YES;
    if (save) {
      panel.nameFieldStringValue = @"poketone-save.txt";
    } else {
      NSOpenPanel *open = (NSOpenPanel *)panel;
      open.canChooseDirectories = NO;
      open.canChooseFiles = YES;
      open.allowsMultipleSelection = NO;
    }
    void *handle = (__bridge_retained void *)panel;
    [panel beginSheetModalForWindow:view.window completionHandler:^(NSModalResponse response) {
      [view.window makeKeyWindow];
      [view.window makeFirstResponder:view];
      completed(response == NSModalResponseOK ? panel.URL.path.UTF8String : NULL);
    }];
    return handle;
  }
}

void poketone_cancel_file(void *handle) {
  [(__bridge NSSavePanel *)handle cancel:nil];
}

void poketone_release_file(void *handle) {
  CFRelease(handle);
}
