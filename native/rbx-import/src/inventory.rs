use serde_json::{json, Value};
use std::collections::HashSet;
pub fn inspect(xml: &str) -> Result<(Vec<Value>, Vec<Value>), String> {
    if xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY") {
        return Err("DTD/DOCTYPE is not supported".into());
    }
    let doc = roxmltree::Document::parse(xml).map_err(|e| e.to_string())?;
    if doc.root_element().tag_name().name() != "roblox" {
        return Err("Expected Roblox place XML".into());
    }
    let mut items = Vec::new();
    let mut diagnostics = Vec::new();
    let mut refs = HashSet::new();
    for item in doc.descendants().filter(|n| n.has_tag_name("Item")) {
        if item.ancestors().count() > 256 {
            return Err("XML_DEPTH_LIMIT".into());
        }
        if let Some(r) = item.attribute("referent") {
            if !refs.insert(r.to_owned()) {
                return Err("Duplicate serialized referent".into());
            }
        }
    }
    let known = [
        "Axes",
        "BinaryString",
        "bool",
        "BrickColor",
        "CFrame",
        "Color3",
        "Color3uint8",
        "ColorSequence",
        "Content",
        "ContentId",
        "CoordinateFrame",
        "double",
        "Faces",
        "float",
        "Font",
        "int",
        "int64",
        "NumberRange",
        "NumberSequence",
        "OptionalCoordinateFrame",
        "PhysicalProperties",
        "ProtectedString",
        "Ray",
        "Rect2D",
        "Ref",
        "Region3",
        "Region3int16",
        "SecurityCapabilities",
        "SharedString",
        "string",
        "token",
        "UDim",
        "UDim2",
        "UniqueId",
        "Vector2",
        "Vector2int16",
        "Vector3",
        "Vector3int16",
        "NetAssetRef",
    ];
    for item in doc.descendants().filter(|n| n.has_tag_name("Item")) {
        let mut props = Vec::new();
        if let Some(properties) = item.children().find(|n| n.has_tag_name("Properties")) {
            for p in properties.children().filter(|n| n.is_element()) {
                let t = p.tag_name().name();
                let name = p.attribute("name").unwrap_or("");
                let text = p.text().unwrap_or("");
                props.push(json!({"name":name,"type":t,"text":text}));
                if !known.contains(&t) {
                    diagnostics.push(json!({"code":"UNKNOWN_PROPERTY_TYPE","severity":"warning","message":format!("{}: unsupported serialized type {}",name,t)}));
                }
                if t == "Ref"
                    && text != "null"
                    && text != "nil"
                    && !text.is_empty()
                    && !refs.contains(text)
                {
                    diagnostics.push(json!({"code":"DANGLING_REFERENT","severity":"warning","message":format!("{} references absent {}",name,text)}));
                }
            }
        }
        items.push(json!({"referent":item.attribute("referent"),"className":item.attribute("class"),"properties":props}));
    }
    if items.len() > 200_000 {
        return Err("INSTANCE_LIMIT".into());
    }
    Ok((items, diagnostics))
}
