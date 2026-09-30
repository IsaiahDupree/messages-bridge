// Decode local Messages attributedBody archives using Apple's Foundation.
// JSON only on stdout; never persist message content.
#import <Foundation/Foundation.h>
int main(void) {
 @autoreleasepool {
  @try {
   NSData *input=[[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
   NSError *error=nil;
   id rows=[NSJSONSerialization JSONObjectWithData:input options:NSJSONReadingMutableContainers error:&error];
   if(![rows isKindOfClass:[NSArray class]]) return 2;
   for(NSMutableDictionary *row in rows){
    id text=row[@"text"], body=row[@"body"];
    if((!text || text==[NSNull null]) && [body isKindOfClass:[NSString class]] && [body length]){
     @try {
      NSData *data=[[NSData alloc] initWithBase64EncodedString:body options:0];
      id value=[NSUnarchiver unarchiveObjectWithData:data];
      if(![value isKindOfClass:[NSAttributedString class]]) @throw [NSException exceptionWithName:@"Decode" reason:nil userInfo:nil];
      row[@"text"]=[value string];row[@"text_source"]=@"attributedBody";
     } @catch(NSException *exception){row[@"text"]=[NSNull null];row[@"decode_error"]=@YES;}
    }else{row[@"text_source"]=(!text || text==[NSNull null])?@"none":@"text";}
    [row removeObjectForKey:@"body"];
   }
   NSData *output=[NSJSONSerialization dataWithJSONObject:rows options:0 error:&error];
   if(!output)return 3;
   [[NSFileHandle fileHandleWithStandardOutput] writeData:output];
  } @catch(NSException *exception){return 4;}
 }
 return 0;
}
