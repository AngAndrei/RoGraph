use serde_json::{json,Value,Map};
use rbx_xml::{DecodeOptions,DecodePropertyBehavior};
pub fn decode(xml:&str)->Result<Value,String>{
 let (items,mut diagnostics)=crate::inventory::inspect(xml)?;
 let dom=rbx_xml::from_reader(xml.as_bytes(),DecodeOptions::new().property_behavior(DecodePropertyBehavior::ReadUnknown)).map_err(|e|e.to_string())?;
 let mut instances=Vec::new();let mut stack=vec![(dom.root_ref(),None::<String>)];let mut index=0;
 while let Some((id,parent))=stack.pop(){let i=dom.get_by_ref(id).ok_or("Invalid DOM reference")?;let synthetic=parent.is_none();let mut properties=Map::new();
  for (key,value) in &i.properties {
   let v=if let rbx_types::Variant::Ref(target)=value {json!({"type":"Ref","value":if target.is_some(){Some(target.to_string())}else{None}})}else{
    let v=serde_json::to_value(value).map_err(|e|e.to_string())?;
    if let Some(obj)=v.as_object(){if obj.len()==1 {let(t,v)=obj.iter().next().unwrap();json!({"type":t,"value":v})}else{json!({"type":"value","value":v})}}else{json!({"type":"value","value":v})}
   };properties.insert(key.to_string(),v);
  }
  let raw=if synthetic{None}else{let v=items.get(index);index+=1;v};
  instances.push(json!({"id":id.to_string(),"parentId":parent,"name":i.name.as_str(),"className":i.class.as_str(),"properties":properties,"synthetic":synthetic,"originalReferent":raw.and_then(|v|v.get("referent"))}));
  for child in i.children().iter().rev(){stack.push((*child,Some(id.to_string())));}
 }
 if index!=items.len(){diagnostics.push(json!({"code":"INVENTORY_MISMATCH","severity":"error","message":"Decoded object count differs from raw inventory"}));}
 Ok(json!({"instances":instances,"inventory":{"items":items},"diagnostics":diagnostics,"importerVersion":env!("CARGO_PKG_VERSION")}))
}
