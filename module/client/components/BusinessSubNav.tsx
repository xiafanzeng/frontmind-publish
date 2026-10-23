import { businessModuleOf } from "../businessNav";
import "../publishing.nav.css";

/**
 * 左侧业务导航的二级层：显示当前一级模块下的真实业务页面入口。
 * 一级导航由共享外壳侧栏（ModuleShell navigationModules）渲染，本组件只负责二级，
 * 不重复渲染一级，也不添加业务页面内部的流程入口。
 */
export default function BusinessSubNav({
  activeLeaf,
  onSelect,
}: {
  activeLeaf: string;
  onSelect: (path: string) => void;
}) {
  const moduleItem = businessModuleOf(activeLeaf);
  if (moduleItem.views.length <= 1) return null;
  return (
    <nav className="business-subnav" aria-label={`${moduleItem.label}页面导航`}>
      <h2>{moduleItem.label}</h2>
      {moduleItem.views.map(leaf => (
        <button
          key={leaf.id}
          type="button"
          className={
            "business-subnav-item " +
            (leaf.id === activeLeaf ? "is-active" : "")
          }
          aria-current={leaf.id === activeLeaf ? "page" : undefined}
          onClick={() => onSelect(leaf.path)}
        >
          <span>{leaf.label}</span>
        </button>
      ))}
    </nav>
  );
}
